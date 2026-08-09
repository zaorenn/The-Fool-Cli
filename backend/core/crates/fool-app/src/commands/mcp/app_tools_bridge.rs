//! `foolcore app-tools-bridge`: stdio ↔ HTTP for the application's own tools.
//!
//! An agent embedded in this process reaches the app-tools server directly —
//! it is a loopback port in the same process tree, and a bridge would exist
//! only to be spawned and killed. A hosted CLI agent (Claude Code, Codex) is a
//! separate process that speaks MCP over stdin and stdout and has no way to be
//! handed a port and a bearer token, so this stands in between: one JSON-RPC
//! message in on stdin, one HTTP POST to the listener, the answer back out in
//! the framing the client used.
//!
//! Which conversation the calls belong to is carried by the path
//! (`/mcp/<conversation>`), because one listener serves them all and a
//! permission decision is made per conversation. The bridge never reads it; it
//! is told the whole path and posts to it.
//!
//! Requests are answered concurrently. A tool call here can mean a screen
//! capture and a model describing what it saw, and a client that pipelined a
//! cheap call behind it would otherwise wait out the expensive one.

use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use fool_api_types::AppToolsMcpConfig;
use fool_mcp_server::JsonRpcResponse;
use fool_mcp_server::protocol::INTERNAL_ERROR;
use serde_json::Value;
use tokio::io::{AsyncWrite, BufReader};
use tokio::sync::Mutex;

use crate::commands::error::{CliBoundaryCode, CliBoundaryError, missing_env, parse_required_port};
use crate::commands::mcp::stdio::{self, Framing};

const SUBCOMMAND: &str = AppToolsMcpConfig::BRIDGE_SUBCOMMAND;
const CONNECT_HOST: &str = "127.0.0.1";

/// How long one call may take before the bridge answers for it.
///
/// The listener gives a tool 60 seconds to come back from the renderer. This
/// is that plus room to be slow, so the deadline that decides is the one that
/// can explain itself: the server turns a late tool into a sentence the model
/// can say, where a client timing out here would only see the server go quiet.
const CALL_TIMEOUT: Duration = Duration::from_secs(90);

/// Entry point for `foolcore app-tools-bridge`.
pub async fn run_app_tools_bridge() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            // stderr, not tracing: the parent agent CLI captures stderr and
            // shows it to the user when the bridge dies on startup.
            eprintln!("{}", err.stderr_line());
            err.exit_code()
        }
    }
}

async fn run() -> Result<(), CliBoundaryError> {
    let env = Arc::new(BridgeEnv::from_env()?);
    let client = Arc::new(build_client()?);
    let stdout = Arc::new(Mutex::new(tokio::io::stdout()));
    let mut reader = BufReader::new(tokio::io::stdin());

    let mut in_flight = Vec::new();
    while let Some(message) = stdio::read_message(&mut reader, SUBCOMMAND).await? {
        let (env, client, stdout) = (env.clone(), client.clone(), stdout.clone());
        in_flight.push(tokio::spawn(async move {
            if let Err(err) = exchange(&client, &env, &stdout, message.body, message.framing).await {
                eprintln!("{}", err.stderr_line());
            }
        }));
        in_flight.retain(|handle| !handle.is_finished());
    }

    // stdin closed: the client is going away, but a call it already made may
    // still be waiting on the renderer. Answering it costs nothing and losing
    // it looks, in a transcript, like a tool that silently did nothing.
    for handle in in_flight {
        let _ = handle.await;
    }
    Ok(())
}

/// One message across and, unless it was a notification, one answer back.
async fn exchange<W: AsyncWrite + Unpin>(
    client: &reqwest::Client,
    env: &BridgeEnv,
    stdout: &Mutex<W>,
    body: Vec<u8>,
    framing: Framing,
) -> Result<(), CliBoundaryError> {
    let request: Value = serde_json::from_slice(&body).map_err(|_| {
        CliBoundaryError::new(
            CliBoundaryCode::McpStdinJsonInvalid,
            SUBCOMMAND,
            "stdin MCP frame body is not valid JSON",
        )
    })?;

    // No id means nothing is waiting for an answer, and writing one anyway is
    // a message the client cannot match to any call it made.
    let id = request.get("id").filter(|id| !id.is_null()).cloned();

    let reply = match post(client, env, &body).await {
        Ok(reply) => reply,
        // A transport failure has to come back as an answer. Staying silent
        // would leave the client waiting on this id until it gave up on the
        // server entirely, and every later call with it.
        Err(err) if id.is_some() => {
            eprintln!("{}", err.stderr_line());
            serde_json::to_vec(&JsonRpcResponse::error(
                id.clone(),
                INTERNAL_ERROR,
                "the application's tool server could not be reached",
            ))
            .map_err(|_| json_serialize_failed())?
        }
        Err(err) => return Err(err),
    };

    if id.is_none() {
        return Ok(());
    }

    let mut guard = stdout.lock().await;
    stdio::write_message(&mut *guard, framing, &reply, SUBCOMMAND).await
}

async fn post(client: &reqwest::Client, env: &BridgeEnv, body: &[u8]) -> Result<Vec<u8>, CliBoundaryError> {
    let response = client
        .post(&env.url)
        .bearer_auth(&env.token)
        .header("content-type", "application/json")
        .body(body.to_vec())
        .send()
        .await
        .map_err(|_| {
            CliBoundaryError::new(
                CliBoundaryCode::McpHttpConnectOrTimeout,
                SUBCOMMAND,
                "failed to reach the app tools server",
            )
            .with_field("url", env.url.clone())
        })?;

    let status = response.status();
    if !status.is_success() {
        return Err(CliBoundaryError::new(
            CliBoundaryCode::McpHttpStatusError,
            SUBCOMMAND,
            "app tools server rejected the call",
        )
        .with_field("status", status.as_u16().to_string()));
    }

    response.bytes().await.map(|bytes| bytes.to_vec()).map_err(|_| {
        CliBoundaryError::new(
            CliBoundaryCode::McpHttpResponseReadFailed,
            SUBCOMMAND,
            "failed to read the app tools server's answer",
        )
    })
}

fn build_client() -> Result<reqwest::Client, CliBoundaryError> {
    reqwest::Client::builder()
        // The listener is on loopback in this machine's own process tree. A
        // configured proxy has no business seeing these calls, and on a machine
        // with one set the request would not arrive at all.
        .no_proxy()
        .timeout(CALL_TIMEOUT)
        .build()
        .map_err(|_| {
            CliBoundaryError::new(
                CliBoundaryCode::McpHttpConnectOrTimeout,
                SUBCOMMAND,
                "failed to build the app tools HTTP client",
            )
        })
}

fn json_serialize_failed() -> CliBoundaryError {
    CliBoundaryError::new(
        CliBoundaryCode::McpJsonSerializeFailed,
        SUBCOMMAND,
        "failed to serialize MCP JSON frame",
    )
}

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
struct BridgeEnv {
    url: String,
    token: String,
}

impl BridgeEnv {
    fn from_env() -> Result<Self, CliBoundaryError> {
        let port = std::env::var(AppToolsMcpConfig::ENV_PORT)
            .map_err(|_| missing_env(SUBCOMMAND, AppToolsMcpConfig::ENV_PORT))?;
        let token = std::env::var(AppToolsMcpConfig::ENV_TOKEN)
            .map_err(|_| missing_env(SUBCOMMAND, AppToolsMcpConfig::ENV_TOKEN))?;
        let path = std::env::var(AppToolsMcpConfig::ENV_PATH)
            .map_err(|_| missing_env(SUBCOMMAND, AppToolsMcpConfig::ENV_PATH))?;
        Self::from_values(&port, &token, &path)
    }

    fn from_values(port_raw: &str, token: &str, path: &str) -> Result<Self, CliBoundaryError> {
        let port = parse_required_port(SUBCOMMAND, AppToolsMcpConfig::ENV_PORT, port_raw)?;
        let path = if path.starts_with('/') {
            path.to_owned()
        } else {
            format!("/{path}")
        };
        Ok(Self {
            url: format!("http://{CONNECT_HOST}:{port}{path}"),
            token: token.to_owned(),
        })
    }
}

#[cfg(test)]
#[path = "app_tools_bridge_test.rs"]
mod app_tools_bridge_test;
