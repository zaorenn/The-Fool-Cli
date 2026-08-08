//! MCP over HTTP, for a client that lives in the same process tree.
//!
//! Written against the socket directly rather than through a web framework,
//! because this listener answers exactly one kind of caller on loopback and the
//! team server next door does the same. What matters here is that the token is
//! checked before anything is parsed, and that a call which names no host is a
//! 404 rather than a panic.

use std::sync::Arc;

use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

use crate::host::{HostResolver, McpToolHost};
use crate::protocol::{INVALID_PARAMS, JsonRpcRequest, JsonRpcResponse, METHOD_NOT_FOUND, PARSE_ERROR, PROTOCOL_VERSION};

pub const SERVER_NAME: &str = "fool-app-tools";
pub const SERVER_VERSION: &str = "1.0.0";

/// One request, answered.
///
/// Separated from the socket so it can be tested without one: the socket is
/// plumbing, this is the protocol.
pub async fn dispatch(host: Arc<dyn McpToolHost>, request: JsonRpcRequest) -> JsonRpcResponse {
    match request.method.as_str() {
        "initialize" => JsonRpcResponse::success(
            request.id,
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            }),
        ),
        "tools/list" => {
            let tools = host.list_tools().await;
            JsonRpcResponse::success(request.id, json!({ "tools": tools }))
        }
        "tools/call" => {
            let params = request.params.unwrap_or_else(|| json!({}));
            let Some(name) = params["name"].as_str() else {
                return JsonRpcResponse::error(request.id, INVALID_PARAMS, "name is required");
            };
            // A tool that could not do its job is a *result*, not a protocol
            // error: the model has to be able to read what went wrong and say
            // it. A JSON-RPC error is swallowed by the client instead.
            let (text, is_error) = match host.call_tool(name, params["arguments"].clone()).await {
                Ok(text) => (text, false),
                Err(message) => (message, true),
            };
            JsonRpcResponse::success(
                request.id,
                json!({"content": [{"type": "text", "text": text}], "isError": is_error}),
            )
        }
        other => JsonRpcResponse::error(request.id, METHOD_NOT_FOUND, format!("unknown method {other}")),
    }
}

/// Serves [`dispatch`] over HTTP until `shutdown` flips.
pub async fn serve_http(
    listener: TcpListener,
    token: String,
    resolver: Arc<dyn HostResolver>,
    mut shutdown: watch::Receiver<bool>,
) {
    loop {
        tokio::select! {
            _ = shutdown.changed() => {
                if *shutdown.borrow() {
                    return;
                }
            }
            accepted = listener.accept() => {
                let Ok((stream, _)) = accepted else { continue };
                tokio::spawn(serve_connection(stream, token.clone(), resolver.clone()));
            }
        }
    }
}

/// The largest request this server will assemble before giving up.
///
/// Generous for a JSON-RPC document and small enough that an unauthorised
/// caller cannot make this process hold memory on its behalf.
const MAX_REQUEST_BYTES: usize = 4 * 1024 * 1024;

async fn serve_connection(mut stream: TcpStream, token: String, resolver: Arc<dyn HostResolver>) {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 8192];

    loop {
        let Ok(read) = stream.read(&mut chunk).await else { return };
        if read == 0 {
            return;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_REQUEST_BYTES {
            let _ = stream
                .write_all(b"HTTP/1.1 413 Payload Too Large\r\ncontent-length: 0\r\n\r\n")
                .await;
            return;
        }

        let Some(position) = find_header_end(&buffer) else { continue };
        let raw = String::from_utf8_lossy(&buffer[..position]).into_owned();
        let headers = raw.to_ascii_lowercase();

        if !headers.contains(&format!("authorization: bearer {}", token.to_ascii_lowercase())) {
            let _ = stream
                .write_all(b"HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\n\r\n")
                .await;
            return;
        }

        let Some(host) = resolver.resolve(request_path(&raw)) else {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\n\r\n").await;
            return;
        };

        let length = content_length(&headers).unwrap_or(0);
        let body_start = position + 4;
        if buffer.len() < body_start + length {
            continue;
        }

        let response = match serde_json::from_slice::<JsonRpcRequest>(&buffer[body_start..body_start + length]) {
            Ok(request) => dispatch(host, request).await,
            Err(error) => JsonRpcResponse::error(None, PARSE_ERROR, error.to_string()),
        };
        let payload = serde_json::to_vec(&response).unwrap_or_default();
        let head = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n",
            payload.len()
        );
        let _ = stream.write_all(head.as_bytes()).await;
        let _ = stream.write_all(&payload).await;
        return;
    }
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

/// `POST /mcp/<conversation-id> HTTP/1.1` — the second word.
fn request_path(raw_headers: &str) -> &str {
    raw_headers.split_whitespace().nth(1).unwrap_or("/")
}

fn content_length(lowercased_headers: &str) -> Option<usize> {
    lowercased_headers
        .lines()
        .find_map(|line| line.trim().strip_prefix("content-length:"))
        .and_then(|value| value.trim().parse().ok())
}

#[cfg(test)]
#[path = "http_test.rs"]
mod http_test;
