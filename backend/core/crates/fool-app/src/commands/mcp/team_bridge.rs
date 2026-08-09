//! `foolcore mcp-bridge` subcommand: stdio ↔ TCP bridge for the team MCP server.
//!
//! Spawned by the ACP agent CLI as an MCP server with command `foolcore mcp-bridge`.
//! stdio side speaks JSON-RPC 2.0 in whichever framing the client uses — see
//! [`super::stdio`], which reads both and answers in the one it was given;
//! TCP side speaks 4-byte big-endian length-prefixed JSON frames against
//! `127.0.0.1:<TEAM_MCP_PORT>` (reusing `fool_team::mcp::protocol`).
//!
//! On the first `initialize` request from the CLI, the bridge injects
//! `auth_token` and `slot_id` (read from env) into `params` before forwarding
//! to the TCP server; subsequent messages are transparently proxied in both
//! directions. Any unrecoverable error exits non-zero so the ACP CLI marks
//! the MCP server as broken (see docs/teams/mcp.md §4.4 / §4.6).

use std::io::{self, IsTerminal};
use std::process::ExitCode;

use fool_api_types::TeamMcpStdioConfig;
use fool_team::mcp::protocol::{read_frame, write_frame};
use serde_json::Value;
use tokio::io::BufReader;
use tokio::net::TcpStream;

use crate::commands::error::{CliBoundaryCode, CliBoundaryError, missing_env, parse_required_port};
use crate::commands::mcp::stdio::{self, SharedFraming};

const SUBCOMMAND: &str = "mcp-bridge";
const CONNECT_ADDR_HOST: &str = "127.0.0.1";

/// Entry point for `foolcore mcp-bridge`. Returns an [`ExitCode`] so the
/// binary surfaces non-zero on any failure (ACP CLI uses that to mark the MCP
/// server as broken).
pub async fn run_mcp_bridge() -> ExitCode {
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
    let env = BridgeEnv::from_env()?;

    let tcp = TcpStream::connect((CONNECT_ADDR_HOST, env.port)).await.map_err(|_| {
        CliBoundaryError::new(
            CliBoundaryCode::McpTcpConnectFailed,
            SUBCOMMAND,
            "failed to connect to local MCP TCP listener",
        )
        .with_field("host", CONNECT_ADDR_HOST)
        .with_field("port", env.port.to_string())
    })?;
    tcp.set_nodelay(true).ok();
    let (tcp_reader, tcp_writer) = tcp.into_split();

    if std::io::stdin().is_terminal() {
        return Err(CliBoundaryError::new(
            CliBoundaryCode::McpStdinTty,
            SUBCOMMAND,
            "stdin must be provided by an MCP-capable agent CLI",
        ));
    }
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();

    // The two directions run on separate tasks, so the framing the client
    // turned out to speak has to be handed from the one that learns it to the
    // one that has to answer in it.
    let framing = SharedFraming::default();

    let env_for_stdin = env.clone();
    let framing_for_stdin = framing.clone();
    let stdin_task =
        tokio::spawn(async move { forward_stdin_to_tcp(stdin, tcp_writer, env_for_stdin, framing_for_stdin).await });
    let tcp_task = tokio::spawn(async move { forward_tcp_to_stdout(tcp_reader, stdout, framing).await });

    // First task to return decides the exit path; we treat clean EOF from
    // either side as "other side closed, we're done".
    tokio::select! {
        res = stdin_task => {
            res.map_err(|_| task_join_error())??;
        }
        res = tcp_task => {
            res.map_err(|_| task_join_error())??;
        }
    }
    Ok(())
}

fn task_join_error() -> CliBoundaryError {
    CliBoundaryError::new(
        CliBoundaryCode::McpTaskJoinPanic,
        SUBCOMMAND,
        "MCP bridge worker task failed",
    )
}

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct BridgeEnv {
    port: u16,
    token: String,
    slot_id: String,
}

impl BridgeEnv {
    fn from_env() -> Result<Self, CliBoundaryError> {
        let port_raw = std::env::var(TeamMcpStdioConfig::ENV_PORT)
            .map_err(|_| missing_env(SUBCOMMAND, TeamMcpStdioConfig::ENV_PORT))?;
        let token = std::env::var(TeamMcpStdioConfig::ENV_TOKEN)
            .map_err(|_| missing_env(SUBCOMMAND, TeamMcpStdioConfig::ENV_TOKEN))?;
        let slot_id = std::env::var(TeamMcpStdioConfig::ENV_SLOT_ID)
            .map_err(|_| missing_env(SUBCOMMAND, TeamMcpStdioConfig::ENV_SLOT_ID))?;
        Self::from_values(&port_raw, &token, &slot_id)
    }

    fn from_values(port_raw: &str, token: &str, slot_id: &str) -> Result<Self, CliBoundaryError> {
        let port = parse_required_port(SUBCOMMAND, TeamMcpStdioConfig::ENV_PORT, port_raw)?;
        Ok(Self {
            port,
            token: token.to_owned(),
            slot_id: slot_id.to_owned(),
        })
    }
}

// ---------------------------------------------------------------------------
// stdin → TCP: read one stdio message, inject auth on `initialize`, frame to TCP
// ---------------------------------------------------------------------------

async fn forward_stdin_to_tcp<R, W>(
    stdin: R,
    mut tcp_writer: W,
    env: BridgeEnv,
    framing: SharedFraming,
) -> Result<(), CliBoundaryError>
where
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin,
{
    let mut reader = BufReader::new(stdin);
    loop {
        let message = match stdio::read_message(&mut reader, SUBCOMMAND).await? {
            Some(message) => message,
            None => return Ok(()),
        };
        framing.set(message.framing);
        let body = message.body;

        let mut value: Value = serde_json::from_slice(&body).map_err(|_| {
            CliBoundaryError::new(
                CliBoundaryCode::McpStdinJsonInvalid,
                SUBCOMMAND,
                "stdin MCP frame body is not valid JSON",
            )
        })?;

        if value.get("method").and_then(Value::as_str) == Some("initialize") {
            inject_auth(&mut value, &env);
        }

        let bytes = serde_json::to_vec(&value).map_err(|_| {
            CliBoundaryError::new(
                CliBoundaryCode::McpJsonSerializeFailed,
                SUBCOMMAND,
                "failed to serialize MCP JSON frame",
            )
        })?;
        write_frame(&mut tcp_writer, &bytes).await.map_err(|_| {
            CliBoundaryError::new(
                CliBoundaryCode::McpTcpWriteFailed,
                SUBCOMMAND,
                "failed to write MCP frame to TCP listener",
            )
        })?;
    }
}

fn inject_auth(value: &mut Value, env: &BridgeEnv) {
    let params = value.as_object_mut().and_then(|obj| {
        obj.entry("params")
            .or_insert(Value::Object(Default::default()))
            .as_object_mut()
    });
    if let Some(params) = params {
        params.insert("auth_token".into(), Value::String(env.token.clone()));
        params.insert("slot_id".into(), Value::String(env.slot_id.clone()));
    }
}

// ---------------------------------------------------------------------------
// TCP → stdout: read length-prefixed frames, write them in the client's framing
// ---------------------------------------------------------------------------

async fn forward_tcp_to_stdout<R, W>(
    mut tcp_reader: R,
    mut stdout: W,
    framing: SharedFraming,
) -> Result<(), CliBoundaryError>
where
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin,
{
    loop {
        let frame = match read_frame(&mut tcp_reader).await {
            Ok(f) => f,
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => {
                return Ok(());
            }
            Err(_) => {
                return Err(CliBoundaryError::new(
                    CliBoundaryCode::McpTcpReadFailed,
                    SUBCOMMAND,
                    "failed to read MCP frame from TCP listener",
                ));
            }
        };
        stdio::write_message(&mut stdout, framing.get(), &frame, SUBCOMMAND).await?;
    }
}

// ---------------------------------------------------------------------------
// Unit tests (integration tests live in tests/mcp_bridge.rs)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn env() -> BridgeEnv {
        BridgeEnv {
            port: 1,
            token: "tok".into(),
            slot_id: "slot-a".into(),
        }
    }

    #[test]
    fn bridge_env_rejects_invalid_port_with_stable_code() {
        let err = BridgeEnv::from_values("not-a-port", "tok", "slot-a").unwrap_err();
        assert_eq!(err.code(), crate::commands::error::CliBoundaryCode::McpEnvInvalidPort);
        assert_eq!(err.exit_code(), std::process::ExitCode::from(2));
    }

    #[test]
    fn inject_auth_adds_fields_when_params_missing() {
        let mut v = json!({"jsonrpc":"2.0","id":1,"method":"initialize"});
        inject_auth(&mut v, &env());
        assert_eq!(v["params"]["auth_token"], "tok");
        assert_eq!(v["params"]["slot_id"], "slot-a");
    }

    #[test]
    fn inject_auth_preserves_existing_params() {
        let mut v = json!({
            "jsonrpc":"2.0","id":1,"method":"initialize",
            "params": {"protocolVersion":"2024-11-05","capabilities":{}}
        });
        inject_auth(&mut v, &env());
        assert_eq!(v["params"]["protocolVersion"], "2024-11-05");
        assert_eq!(v["params"]["auth_token"], "tok");
        assert_eq!(v["params"]["slot_id"], "slot-a");
    }

    #[test]
    fn inject_auth_overrides_client_supplied_credentials() {
        // The CLI cannot be trusted to know the bridge's token / slot id,
        // so whatever it sent gets replaced.
        let mut v = json!({
            "jsonrpc":"2.0","id":1,"method":"initialize",
            "params":{"auth_token":"stale","slot_id":"wrong"}
        });
        inject_auth(&mut v, &env());
        assert_eq!(v["params"]["auth_token"], "tok");
        assert_eq!(v["params"]["slot_id"], "slot-a");
    }

    #[tokio::test]
    async fn forward_stdin_injects_only_on_initialize() {
        let initialize = br#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
        let tools_list = br#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#;
        let input = format!(
            "Content-Length: {}\r\n\r\n{}Content-Length: {}\r\n\r\n{}",
            initialize.len(),
            std::str::from_utf8(initialize).unwrap(),
            tools_list.len(),
            std::str::from_utf8(tools_list).unwrap(),
        );
        let mut out = Vec::<u8>::new();
        forward_stdin_to_tcp(input.as_bytes(), &mut out, env(), SharedFraming::default())
            .await
            .unwrap();

        // Parse two frames back out.
        let mut cursor = std::io::Cursor::new(out);
        let f1 = read_frame(&mut cursor).await.unwrap();
        let f2 = read_frame(&mut cursor).await.unwrap();
        let v1: Value = serde_json::from_slice(&f1).unwrap();
        let v2: Value = serde_json::from_slice(&f2).unwrap();
        assert_eq!(v1["params"]["auth_token"], "tok");
        assert_eq!(v1["params"]["slot_id"], "slot-a");
        assert!(v2.get("params").is_none(), "tools/list params untouched");
    }

    #[tokio::test]
    async fn forward_tcp_writes_content_length_framed_stdout() {
        let payload = br#"{"jsonrpc":"2.0","id":1,"result":{}}"#;
        let mut framed = Vec::new();
        write_frame(&mut framed, payload).await.unwrap();

        let mut out = Vec::<u8>::new();
        forward_tcp_to_stdout(&framed[..], &mut out, SharedFraming::default())
            .await
            .unwrap();

        let mut cursor = std::io::Cursor::new(out);
        let message = stdio::read_message(&mut cursor, SUBCOMMAND).await.unwrap().unwrap();
        let parsed: Value = serde_json::from_slice(&message.body).unwrap();
        assert_eq!(parsed["id"], 1);
    }

    /// A client that speaks one JSON document per line has to be answered the
    /// same way. Both halves of the bridge are driven here because the framing
    /// is learned by one and used by the other, and a cell that never got set
    /// would still pass a test that only looked at the reading half.
    #[tokio::test]
    async fn a_line_framed_client_is_answered_in_lines() {
        let framing = SharedFraming::default();
        let mut to_tcp = Vec::<u8>::new();
        forward_stdin_to_tcp(
            &br#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#[..],
            &mut to_tcp,
            env(),
            framing.clone(),
        )
        .await
        .unwrap();

        let mut framed = Vec::new();
        write_frame(&mut framed, br#"{"jsonrpc":"2.0","id":1,"result":{}}"#)
            .await
            .unwrap();
        let mut out = Vec::<u8>::new();
        forward_tcp_to_stdout(&framed[..], &mut out, framing).await.unwrap();

        let text = String::from_utf8(out).unwrap();
        assert!(!text.contains("Content-Length"), "{text}");
        assert!(text.ends_with('\n'), "{text}");
        let parsed: Value = serde_json::from_str(text.trim()).unwrap();
        assert_eq!(parsed["id"], 1);
    }
}
