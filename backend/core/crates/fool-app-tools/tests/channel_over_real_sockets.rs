//! The channel, proved over real sockets.
//!
//! The unit tests prove each half in isolation: `dispatch` answers JSON-RPC,
//! `PendingCalls` times out, the routes accept a result. What none of them
//! touch is the hand-written HTTP parsing in `serve_connection` — the request
//! line, the bearer token, the content length — because they call `dispatch`
//! directly. This drives the whole thing through a real TCP connection with a
//! stub standing in for the renderer.

use std::sync::Arc;
use std::time::Duration;

use fool_api_types::{APP_TOOL_REQUEST_EVENT, AppToolResult, WebSocketMessage};
use fool_app_tools::{AppToolHosts, AppToolsState, Catalogue, PendingCalls};
use fool_mcp_server::{ToolDescriptor, serve_http};
use fool_realtime::EventBroadcaster;
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

/// Stands in for the renderer: sees the broadcast, answers over the state.
struct StubRenderer {
    state: AppToolsState,
}

impl EventBroadcaster for StubRenderer {
    fn broadcast(&self, event: WebSocketMessage<Value>) {
        if event.name != APP_TOOL_REQUEST_EVENT {
            return;
        }
        let call_id = event.data["call_id"].as_str().unwrap_or_default().to_string();
        let name = event.data["name"].as_str().unwrap_or_default().to_string();
        let pending = self.state.pending.clone();

        // A real renderer answers on its own thread, a while later. Spawning
        // rather than resolving inline is what makes this a test of the wait
        // instead of a test of a value that was already there.
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            pending.resolve(AppToolResult {
                call_id,
                ok: true,
                content: format!("{name} was carried out"),
            });
        });
    }
}

fn descriptor(name: &str) -> ToolDescriptor {
    ToolDescriptor {
        name: name.into(),
        description: "for the test".into(),
        input_schema: json!({"type": "object", "properties": {}}),
    }
}

/// Sends one JSON-RPC document and reads the whole response.
async fn call(port: u16, path: &str, token: Option<&str>, body: Value) -> (String, String) {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.expect("connect");
    let payload = body.to_string();
    let auth = match token {
        Some(token) => format!("authorization: Bearer {token}\r\n"),
        None => String::new(),
    };
    let request = format!(
        "POST {path} HTTP/1.1\r\nhost: 127.0.0.1\r\n{auth}content-type: application/json\r\ncontent-length: {}\r\n\r\n{payload}",
        payload.len()
    );
    stream.write_all(request.as_bytes()).await.expect("write");

    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.expect("read");
    let response = String::from_utf8_lossy(&response).into_owned();
    let (head, body) = response.split_once("\r\n\r\n").unwrap_or((response.as_str(), ""));
    (head.lines().next().unwrap_or_default().to_string(), body.to_string())
}

async fn start() -> (u16, String) {
    let state = AppToolsState {
        catalogue: Arc::new(Catalogue::new()),
        pending: Arc::new(PendingCalls::new(Duration::from_secs(5))),
    };
    state.catalogue.replace(vec![descriptor("app_look_at_screen")]);

    let renderer = Arc::new(StubRenderer { state: state.clone() });

    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let token = "a-token".to_string();

    let hosts = Arc::new(AppToolHosts::new(
        state.catalogue.clone(),
        state.pending.clone(),
        renderer.clone(),
    ));
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    std::mem::forget(shutdown_tx);
    tokio::spawn(serve_http(listener, token.clone(), hosts, shutdown_rx));

    (port, token)
}

#[tokio::test]
async fn a_tool_call_reaches_the_renderer_and_comes_back() {
    let (port, token) = start().await;

    let (status, body) = call(
        port,
        "/mcp/conversation-7",
        Some(&token),
        json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": "app_look_at_screen", "arguments": {}}}),
    )
    .await;

    assert!(status.contains("200"), "status was {status}");
    let parsed: Value = serde_json::from_str(&body).expect("json body");
    assert_eq!(parsed["result"]["isError"], false);
    assert_eq!(
        parsed["result"]["content"][0]["text"],
        "app_look_at_screen was carried out"
    );
}

#[tokio::test]
async fn tools_list_answers_with_what_was_registered() {
    let (port, token) = start().await;

    let (status, body) = call(
        port,
        "/mcp/conversation-7",
        Some(&token),
        json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
    )
    .await;

    assert!(status.contains("200"), "status was {status}");
    let parsed: Value = serde_json::from_str(&body).expect("json body");
    assert_eq!(parsed["result"]["tools"][0]["name"], "app_look_at_screen");
}

#[tokio::test]
async fn a_caller_without_the_token_is_refused() {
    let (port, _token) = start().await;

    let (status, _) = call(
        port,
        "/mcp/conversation-7",
        None,
        json!({"jsonrpc": "2.0", "id": 3, "method": "tools/list"}),
    )
    .await;

    assert!(status.contains("401"), "status was {status}");
}

#[tokio::test]
async fn a_caller_with_the_wrong_token_is_refused() {
    let (port, _token) = start().await;

    let (status, _) = call(
        port,
        "/mcp/conversation-7",
        Some("not-the-token"),
        json!({"jsonrpc": "2.0", "id": 4, "method": "tools/list"}),
    )
    .await;

    assert!(status.contains("401"), "status was {status}");
}

#[tokio::test]
async fn a_request_naming_no_conversation_is_not_found() {
    let (port, token) = start().await;

    let (status, _) = call(
        port,
        "/mcp",
        Some(&token),
        json!({"jsonrpc": "2.0", "id": 5, "method": "tools/list"}),
    )
    .await;

    assert!(status.contains("404"), "status was {status}");
}

#[tokio::test]
async fn an_unadvertised_tool_is_an_error_the_model_can_read() {
    let (port, token) = start().await;

    let (_, body) = call(
        port,
        "/mcp/conversation-7",
        Some(&token),
        json!({"jsonrpc": "2.0", "id": 6, "method": "tools/call",
               "params": {"name": "app_delete_everything", "arguments": {}}}),
    )
    .await;

    let parsed: Value = serde_json::from_str(&body).expect("json body");
    assert_eq!(parsed["result"]["isError"], true);
}
