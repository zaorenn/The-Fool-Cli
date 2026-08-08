# One Harness Implementation Plan — the app's capabilities as agent tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every capability the app owns — looking at the screen, the theme, the settings, the
memory, the taught skills — callable by any agent, over MCP, so there is one tool registry instead of
two.

**Architecture:** A new in-process MCP server (`fool-app-tools`) mirrors the one `fool-team` already
runs. It performs no work: it broadcasts a request to the renderer over the existing websocket, waits
for an HTTP POST carrying the result, and returns it to the agent as a tool result. The renderer
keeps its existing handler (`runVoiceTool`); only its caller changes. The tool catalogue is
registered by the renderer at startup, so the schemas stay in TypeScript and are never copied.

**Tech Stack:** Rust (tokio, axum, serde) in `backend/core`; TypeScript (Electron renderer, vitest)
in `packages/desktop`.

**Scope of this plan:** steps 1 and 2 of `docs/specs/2026-08-08-one-harness-design.md` §8. It lands
working, testable software on its own: an agent — embedded or hosted — can use the app's own tools,
and typed chat gains them. Steps 3 to 6 (moving the spoken turn loop, the claim gate, the measurement
gate, deleting the old loop) get their own plan once these land and the latency of the channel is a
measured number rather than an estimate.

## Global Constraints

- Rust code lives under `backend/core/crates`; a new crate must be added to the `members` list in
  `backend/core/Cargo.toml`.
- Rust unit tests live in a `*_test.rs` file next to the module and are attached with
  `#[cfg(test)] #[path = "..._test.rs"] mod ..._test;`, which is this workspace's established shape.
- TypeScript: strict mode, no `any`, `type` over `interface`, single quotes, path aliases `@/*`,
  `@process/*`, `@renderer/*`.
- No raw interactive HTML in renderer UI; components come from `@arco-design/web-react`, icons from
  `@icon-park/react`. This plan adds no UI, so neither should be needed.
- Every user-facing string is an i18n key, present in all thirteen locales under
  `packages/desktop/src/renderer/services/i18n/locales/`.
- The TypeScript suite is run as `bunx vitest run --maxWorkers=2 <paths>`. Default parallelism
  silently drops whole files on this machine.
- Rust tests are run from `backend/core` as `cargo test -p <crate>`.
- Commits follow Conventional Commits (`<type>(<scope>): <subject>`) and carry **no AI signature** of
  any kind.
- No real user name, real e-mail, or absolute path containing a user name appears in any committed
  file, including test fixtures.

---

### Task 1: A reusable MCP server, extracted from the team one

`fool-team` already implements a JSON-RPC MCP server over TCP and HTTP. Writing a second one by hand
would be the fragmentation this whole project exists to remove, so the generic half is extracted
first and the team server is re-pointed at it. Nothing about team behaviour changes; its tests are
the proof.

**Files:**
- Create: `backend/core/crates/fool-mcp-server/Cargo.toml`
- Create: `backend/core/crates/fool-mcp-server/src/lib.rs`
- Create: `backend/core/crates/fool-mcp-server/src/protocol.rs`
- Create: `backend/core/crates/fool-mcp-server/src/protocol_test.rs`
- Create: `backend/core/crates/fool-mcp-server/src/host.rs`
- Create: `backend/core/crates/fool-mcp-server/src/http.rs`
- Create: `backend/core/crates/fool-mcp-server/src/http_test.rs`
- Modify: `backend/core/Cargo.toml` (workspace `members` and `[workspace.dependencies]`)
- Modify: `backend/core/crates/fool-team/Cargo.toml` (depend on the new crate)
- Modify: `backend/core/crates/fool-team/src/mcp/protocol.rs` (re-export instead of define)

**Interfaces:**
- Produces: `pub trait McpToolHost: Send + Sync { async fn list_tools(&self) -> Vec<ToolDescriptor>; async fn call_tool(&self, name: &str, arguments: Value) -> Result<String, String>; }`
- Produces: `pub trait HostResolver: Send + Sync { fn resolve(&self, path: &str) -> Option<Arc<dyn McpToolHost>>; }`
- Produces: `pub struct ToolDescriptor { pub name: String, pub description: String, pub input_schema: Value }`
- Produces: `pub async fn serve_http(listener: TcpListener, token: String, resolver: Arc<dyn HostResolver>, shutdown: watch::Receiver<bool>)`

**Why a resolver rather than a host.** One listener serves every conversation, and a tool call has to
know which one it belongs to — the permission layer in the next sub-project decides per conversation,
not per application. The conversation id rides in the URL path (`/mcp/{conversation_id}`), which the
MCP client sends as configured and never has to understand. A host per listener would mean a TCP
listener per conversation.
- Produces: `JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcError`, and the error-code constants, moved verbatim from `fool-team/src/mcp/protocol.rs`.

- [ ] **Step 1: Create the crate manifest**

```toml
# backend/core/crates/fool-mcp-server/Cargo.toml
[package]
name = "fool-mcp-server"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
async-trait = { workspace = true }
serde = { workspace = true, features = ["derive"] }
serde_json = { workspace = true }
tokio = { workspace = true, features = ["net", "io-util", "sync", "rt", "macros"] }
tracing = { workspace = true }
```

Add `"crates/fool-mcp-server"` to `members` in `backend/core/Cargo.toml`, and
`fool-mcp-server = { path = "crates/fool-mcp-server" }` to `[workspace.dependencies]`.

- [ ] **Step 2: Write the failing protocol test**

```rust
// backend/core/crates/fool-mcp-server/src/protocol_test.rs
use super::*;

#[test]
fn success_response_carries_the_request_id() {
    let response = JsonRpcResponse::success(Some(7), serde_json::json!({"ok": true}));
    assert_eq!(response.id, Some(7));
    assert_eq!(response.jsonrpc, "2.0");
    assert!(response.error.is_none());
}

#[test]
fn error_response_carries_the_code_and_no_result() {
    let response = JsonRpcResponse::error(Some(1), METHOD_NOT_FOUND, "no such method");
    assert_eq!(response.error.as_ref().map(|e| e.code), Some(METHOD_NOT_FOUND));
    assert!(response.result.is_none());
}
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd backend/core && cargo test -p fool-mcp-server`
Expected: FAIL — the crate has no `protocol` module yet.

- [ ] **Step 4: Move the protocol module across**

Copy the contents of `backend/core/crates/fool-team/src/mcp/protocol.rs` into
`backend/core/crates/fool-mcp-server/src/protocol.rs` unchanged, with two edits: delete the
team-specific `SERVER_NAME` constant, and attach the test file at the bottom.

```rust
// backend/core/crates/fool-mcp-server/src/protocol.rs (tail)
#[cfg(test)]
#[path = "protocol_test.rs"]
mod protocol_test;
```

```rust
// backend/core/crates/fool-mcp-server/src/lib.rs
pub mod host;
pub mod http;
pub mod protocol;

pub use host::{McpToolHost, ToolDescriptor};
pub use http::serve_http;
pub use protocol::{JsonRpcError, JsonRpcRequest, JsonRpcResponse};
```

- [ ] **Step 5: Run the protocol test to verify it passes**

Run: `cd backend/core && cargo test -p fool-mcp-server`
Expected: PASS, 2 tests.

- [ ] **Step 6: Define the host trait**

```rust
// backend/core/crates/fool-mcp-server/src/host.rs
use async_trait::async_trait;
use serde_json::Value;

/// One tool as it is advertised to an agent.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolDescriptor {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

/// Whatever actually performs the work behind an MCP server.
///
/// The server owns the wire; the host owns the meaning. Keeping them apart is
/// what lets the team server and the app server share one transport.
#[async_trait]
pub trait McpToolHost: Send + Sync {
    async fn list_tools(&self) -> Vec<ToolDescriptor>;
    /// `Ok` is the tool's text result; `Err` is a message the model may repeat.
    async fn call_tool(&self, name: &str, arguments: Value) -> Result<String, String>;
}

/// Picks the host for one request, from the path it arrived on.
///
/// A single listener serves every conversation; the path is how a call says
/// which one it belongs to.
pub trait HostResolver: Send + Sync {
    fn resolve(&self, path: &str) -> Option<std::sync::Arc<dyn McpToolHost>>;
}
```

- [ ] **Step 7: Write the failing HTTP-loop test**

```rust
// backend/core/crates/fool-mcp-server/src/http_test.rs
use super::*;
use crate::host::{McpToolHost, ToolDescriptor};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::Arc;

struct EchoHost;

#[async_trait]
impl McpToolHost for EchoHost {
    async fn list_tools(&self) -> Vec<ToolDescriptor> {
        vec![ToolDescriptor {
            name: "echo".into(),
            description: "Say it back".into(),
            input_schema: json!({"type": "object", "properties": {}}),
        }]
    }
    async fn call_tool(&self, name: &str, arguments: Value) -> Result<String, String> {
        if name != "echo" {
            return Err(format!("unknown tool {name}"));
        }
        Ok(arguments["say"].as_str().unwrap_or_default().to_string())
    }
}

#[tokio::test]
async fn tools_list_answers_with_the_hosts_catalogue() {
    let response = dispatch(
        Arc::new(EchoHost),
        JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id: Some(1),
            method: "tools/list".into(),
            params: None,
        },
    )
    .await;
    let tools = response.result.unwrap()["tools"].clone();
    assert_eq!(tools[0]["name"], "echo");
}

#[tokio::test]
async fn tools_call_returns_the_hosts_text() {
    let response = dispatch(
        Arc::new(EchoHost),
        JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id: Some(2),
            method: "tools/call".into(),
            params: Some(json!({"name": "echo", "arguments": {"say": "hello"}})),
        },
    )
    .await;
    assert_eq!(response.result.unwrap()["content"][0]["text"], "hello");
}

#[tokio::test]
async fn an_unknown_method_is_an_error_not_a_panic() {
    let response = dispatch(
        Arc::new(EchoHost),
        JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id: Some(3),
            method: "nonsense".into(),
            params: None,
        },
    )
    .await;
    assert_eq!(response.error.unwrap().code, crate::protocol::METHOD_NOT_FOUND);
}
```

- [ ] **Step 8: Run it to make sure it fails**

Run: `cd backend/core && cargo test -p fool-mcp-server`
Expected: FAIL — `dispatch` is not defined.

- [ ] **Step 9: Write the dispatcher and the HTTP loop**

```rust
// backend/core/crates/fool-mcp-server/src/http.rs
use std::sync::Arc;

use serde_json::json;
use tokio::net::TcpListener;
use tokio::sync::watch;

use crate::host::McpToolHost;
use crate::protocol::{INVALID_PARAMS, JsonRpcRequest, JsonRpcResponse, METHOD_NOT_FOUND, PROTOCOL_VERSION};

pub const SERVER_VERSION: &str = "1.0.0";

/// One request, answered. Separated from the socket so it can be tested
/// without one — the socket is plumbing, this is the protocol.
pub async fn dispatch(host: Arc<dyn McpToolHost>, request: JsonRpcRequest) -> JsonRpcResponse {
    match request.method.as_str() {
        "initialize" => JsonRpcResponse::success(
            request.id,
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "fool-app-tools", "version": SERVER_VERSION},
            }),
        ),
        "tools/list" => {
            let tools = host.list_tools().await;
            JsonRpcResponse::success(request.id, json!({"tools": tools}))
        }
        "tools/call" => {
            let params = request.params.unwrap_or_else(|| json!({}));
            let Some(name) = params["name"].as_str() else {
                return JsonRpcResponse::error(request.id, INVALID_PARAMS, "name is required");
            };
            let arguments = params["arguments"].clone();
            match host.call_tool(name, arguments).await {
                Ok(text) => JsonRpcResponse::success(
                    request.id,
                    json!({"content": [{"type": "text", "text": text}], "isError": false}),
                ),
                Err(message) => JsonRpcResponse::success(
                    request.id,
                    json!({"content": [{"type": "text", "text": message}], "isError": true}),
                ),
            }
        }
        other => JsonRpcResponse::error(request.id, METHOD_NOT_FOUND, format!("unknown method {other}")),
    }
}

/// Serves `dispatch` over HTTP until `shutdown` flips.
///
/// Modelled on `fool-team`'s `http_mcp_loop`: a bearer token on every request,
/// one JSON-RPC document in and one out.
pub async fn serve_http(
    listener: TcpListener,
    token: String,
    resolver: Arc<dyn HostResolver>,
    mut shutdown: watch::Receiver<bool>,
) {
    loop {
        tokio::select! {
            _ = shutdown.changed() => {
                if *shutdown.borrow() { return; }
            }
            accepted = listener.accept() => {
                let Ok((stream, _)) = accepted else { continue };
                let resolver = resolver.clone();
                let token = token.clone();
                tokio::spawn(serve_connection(stream, token, resolver));
            }
        }
    }
}
```

```rust
// backend/core/crates/fool-mcp-server/src/http.rs (continued)
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// One HTTP request, one JSON-RPC document, one response.
///
/// Written by hand rather than through a framework because the team server does
/// the same and this listener answers exactly one caller: an MCP client on
/// loopback. The token is checked before the body is parsed, so an unauthorised
/// caller cannot make this allocate.
async fn serve_connection(mut stream: TcpStream, token: String, resolver: Arc<dyn HostResolver>) {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let Ok(read) = stream.read(&mut chunk).await else { return };
        if read == 0 {
            return;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(position) = find_header_end(&buffer) {
            let raw = String::from_utf8_lossy(&buffer[..position]).into_owned();
            let headers = raw.to_ascii_lowercase();
            if !headers.contains(&format!("authorization: bearer {}", token.to_ascii_lowercase())) {
                let _ = stream.write_all(b"HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\n\r\n").await;
                return;
            }
            // "POST /mcp/<conversation-id> HTTP/1.1" — the second word.
            let path = raw.split_whitespace().nth(1).unwrap_or("/");
            let Some(host) = resolver.resolve(path) else {
                let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\n\r\n").await;
                return;
            };
            let length = content_length(&headers).unwrap_or(0);
            let body_start = position + 4;
            if buffer.len() < body_start + length {
                continue;
            }
            let body = &buffer[body_start..body_start + length];
            let response = match serde_json::from_slice::<JsonRpcRequest>(body) {
                Ok(request) => dispatch(host, request).await,
                Err(error) => JsonRpcResponse::error(None, crate::protocol::PARSE_ERROR, error.to_string()),
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
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn content_length(lowercased_headers: &str) -> Option<usize> {
    lowercased_headers
        .lines()
        .find_map(|line| line.strip_prefix("content-length:"))
        .and_then(|value| value.trim().parse().ok())
}
```

Attach the tests:

```rust
// backend/core/crates/fool-mcp-server/src/http.rs (tail)
#[cfg(test)]
#[path = "http_test.rs"]
mod http_test;
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `cd backend/core && cargo test -p fool-mcp-server`
Expected: PASS, 5 tests.

- [ ] **Step 11: Re-point the team server at the shared protocol**

In `backend/core/crates/fool-team/Cargo.toml` add `fool-mcp-server = { workspace = true }`. Replace
the body of `backend/core/crates/fool-team/src/mcp/protocol.rs` with re-exports, keeping the
team-specific constant where it is:

```rust
// backend/core/crates/fool-team/src/mcp/protocol.rs
pub use fool_mcp_server::protocol::{
    INTERNAL_ERROR, INVALID_PARAMS, INVALID_REQUEST, JsonRpcError, JsonRpcRequest, JsonRpcResponse,
    METHOD_NOT_FOUND, PARSE_ERROR, PROTOCOL_VERSION, read_frame, read_request, write_response,
};

/// The team server names itself; the shared crate does not name it.
pub const SERVER_NAME: &str = "fool-team-mcp";
pub const SERVER_VERSION: &str = "1.0.0";
```

- [ ] **Step 12: Run the team tests to prove nothing moved**

Run: `cd backend/core && cargo test -p fool-team && cargo test -p fool-app --test team_e2e`
Expected: PASS, with the same counts as before the change.

- [ ] **Step 13: Commit**

```bash
git add backend/core/Cargo.toml backend/core/crates/fool-mcp-server backend/core/crates/fool-team
git commit -m "refactor(mcp): one MCP server implementation for two callers"
```

---

### Task 2: The wire types for an app tool call

**Files:**
- Create: `backend/core/crates/fool-api-types/src/app_tool.rs`
- Create: `backend/core/crates/fool-api-types/src/app_tool_test.rs`
- Modify: `backend/core/crates/fool-api-types/src/lib.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `AppToolRequest { conversation_id: String, call_id: String, name: String, arguments: Value }`, `AppToolResult { call_id: String, ok: bool, content: String }`, `APP_TOOL_REQUEST_EVENT: &str = "app.tool.request"`.

- [ ] **Step 1: Write the failing test**

```rust
// backend/core/crates/fool-api-types/src/app_tool_test.rs
use super::*;

#[test]
fn a_request_serialises_with_camel_case_keys_the_renderer_reads() {
    let request = AppToolRequest {
        conversation_id: "c1".into(),
        call_id: "call-1".into(),
        name: "app_look_at_screen".into(),
        arguments: serde_json::json!({"question": "what is open"}),
    };
    let wire = serde_json::to_value(&request).unwrap();
    assert_eq!(wire["conversation_id"], "c1");
    assert_eq!(wire["call_id"], "call-1");
    assert_eq!(wire["name"], "app_look_at_screen");
}

#[test]
fn a_failed_result_still_carries_its_call_id() {
    let parsed: AppToolResult =
        serde_json::from_str(r#"{"call_id":"call-1","ok":false,"content":"the screen cannot be read"}"#).unwrap();
    assert_eq!(parsed.call_id, "call-1");
    assert!(!parsed.ok);
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd backend/core && cargo test -p fool-api-types app_tool`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the types**

```rust
// backend/core/crates/fool-api-types/src/app_tool.rs
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The websocket event name the renderer listens on.
pub const APP_TOOL_REQUEST_EVENT: &str = "app.tool.request";

/// An agent asking the application to do something only the application can do.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppToolRequest {
    pub conversation_id: String,
    pub call_id: String,
    pub name: String,
    pub arguments: Value,
}

/// What came back. `ok: false` is a real answer, not a transport failure:
/// the model is told the tool could not do it and may say so.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppToolResult {
    pub call_id: String,
    pub ok: bool,
    pub content: String,
}
```

Add `pub mod app_tool;` and `pub use app_tool::*;` to `backend/core/crates/fool-api-types/src/lib.rs`
next to its neighbours, and attach the test file at the bottom of `app_tool.rs`:

```rust
#[cfg(test)]
#[path = "app_tool_test.rs"]
mod app_tool_test;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend/core && cargo test -p fool-api-types app_tool`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/core/crates/fool-api-types
git commit -m "feat(app-tools): the wire shape of a call into the application"
```

---

### Task 3: The pending-call registry

The registry is the part that makes a missing answer an error rather than a hang. It is written and
tested on its own, before anything is plugged into it.

**Files:**
- Create: `backend/core/crates/fool-app-tools/Cargo.toml`
- Create: `backend/core/crates/fool-app-tools/src/lib.rs`
- Create: `backend/core/crates/fool-app-tools/src/pending.rs`
- Create: `backend/core/crates/fool-app-tools/src/pending_test.rs`
- Modify: `backend/core/Cargo.toml`

**Interfaces:**
- Consumes: `AppToolResult` from Task 2.
- Produces: `PendingCalls::new(timeout: Duration)`, `async fn issue(&self, call_id: String) -> Result<AppToolResult, PendingError>`, `fn resolve(&self, result: AppToolResult) -> bool`, `enum PendingError { TimedOut }`.

- [ ] **Step 1: Write the failing tests**

```rust
// backend/core/crates/fool-app-tools/src/pending_test.rs
use super::*;
use std::time::Duration;

#[tokio::test]
async fn a_resolved_call_returns_its_result() {
    let pending = std::sync::Arc::new(PendingCalls::new(Duration::from_secs(5)));
    let waiter = pending.clone();
    let task = tokio::spawn(async move { waiter.issue("call-1".into()).await });
    // Give the waiter a moment to register before answering it.
    tokio::task::yield_now().await;
    assert!(pending.resolve(AppToolResult {
        call_id: "call-1".into(),
        ok: true,
        content: "a browser and a code editor".into(),
    }));
    let result = task.await.unwrap().unwrap();
    assert_eq!(result.content, "a browser and a code editor");
}

#[tokio::test]
async fn a_call_nobody_answers_times_out_rather_than_hanging() {
    let pending = PendingCalls::new(Duration::from_millis(20));
    let result = pending.issue("call-2".into()).await;
    assert!(matches!(result, Err(PendingError::TimedOut)));
}

#[tokio::test]
async fn a_result_for_an_unknown_call_is_dropped_without_panicking() {
    let pending = PendingCalls::new(Duration::from_secs(5));
    assert!(!pending.resolve(AppToolResult {
        call_id: "never-issued".into(),
        ok: true,
        content: "ignored".into(),
    }));
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd backend/core && cargo test -p fool-app-tools`
Expected: FAIL — the crate does not exist.

- [ ] **Step 3: Write the crate and the registry**

```toml
# backend/core/crates/fool-app-tools/Cargo.toml
[package]
name = "fool-app-tools"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
async-trait = { workspace = true }
fool-api-types = { workspace = true }
fool-mcp-server = { workspace = true }
fool-realtime = { workspace = true }
serde_json = { workspace = true }
tokio = { workspace = true, features = ["sync", "time", "net", "rt", "macros"] }
tracing = { workspace = true }

[dev-dependencies]
tokio = { workspace = true, features = ["test-util"] }
```

```rust
// backend/core/crates/fool-app-tools/src/pending.rs
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use fool_api_types::AppToolResult;
use tokio::sync::oneshot;

/// Why a call did not come back.
#[derive(Debug, PartialEq, Eq)]
pub enum PendingError {
    /// Nobody answered inside the deadline. The application may be busy, or
    /// closing, or the window that owns the handler may be gone.
    TimedOut,
}

/// Calls that have been sent to the application and not yet answered.
///
/// The deadline is the whole point. Without one, a renderer that never replies
/// leaves an agent waiting forever and a user listening to silence — which is
/// indistinguishable from the app having crashed, and is exactly the failure
/// this project has spent releases removing.
pub struct PendingCalls {
    waiting: Mutex<HashMap<String, oneshot::Sender<AppToolResult>>>,
    timeout: Duration,
}

impl PendingCalls {
    pub fn new(timeout: Duration) -> Self {
        Self {
            waiting: Mutex::new(HashMap::new()),
            timeout,
        }
    }

    pub async fn issue(&self, call_id: String) -> Result<AppToolResult, PendingError> {
        let (tx, rx) = oneshot::channel();
        self.waiting.lock().expect("pending calls lock").insert(call_id.clone(), tx);

        match tokio::time::timeout(self.timeout, rx).await {
            Ok(Ok(result)) => Ok(result),
            // Sender dropped, or the deadline passed. Both are the same thing
            // to the caller: no answer arrived.
            _ => {
                self.waiting.lock().expect("pending calls lock").remove(&call_id);
                Err(PendingError::TimedOut)
            }
        }
    }

    /// Returns whether anybody was waiting for this.
    pub fn resolve(&self, result: AppToolResult) -> bool {
        let sender = self
            .waiting
            .lock()
            .expect("pending calls lock")
            .remove(&result.call_id);
        match sender {
            Some(tx) => tx.send(result).is_ok(),
            None => false,
        }
    }
}

#[cfg(test)]
#[path = "pending_test.rs"]
mod pending_test;
```

```rust
// backend/core/crates/fool-app-tools/src/lib.rs
pub mod pending;

pub use pending::{PendingCalls, PendingError};
```

Add `"crates/fool-app-tools"` to `members` and
`fool-app-tools = { path = "crates/fool-app-tools" }` to `[workspace.dependencies]` in
`backend/core/Cargo.toml`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend/core && cargo test -p fool-app-tools`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/core/Cargo.toml backend/core/crates/fool-app-tools
git commit -m "feat(app-tools): a call that goes unanswered fails instead of hanging"
```

---

### Task 4: The host that forwards to the application

**Files:**
- Create: `backend/core/crates/fool-app-tools/src/host.rs`
- Create: `backend/core/crates/fool-app-tools/src/host_test.rs`
- Create: `backend/core/crates/fool-app-tools/src/catalogue.rs`
- Create: `backend/core/crates/fool-app-tools/src/catalogue_test.rs`
- Modify: `backend/core/crates/fool-app-tools/src/lib.rs`

**Interfaces:**
- Consumes: `PendingCalls` (Task 3), `McpToolHost`/`ToolDescriptor` (Task 1), `AppToolRequest`, `APP_TOOL_REQUEST_EVENT` (Task 2).
- Produces: `Catalogue::new()`, `fn replace(&self, tools: Vec<ToolDescriptor>)`, `fn tools(&self) -> Vec<ToolDescriptor>`; `AppToolHost::new(catalogue: Arc<Catalogue>, pending: Arc<PendingCalls>, broadcaster: Arc<dyn EventBroadcaster>, conversation_id: String)`.

- [ ] **Step 1: Write the failing catalogue test**

```rust
// backend/core/crates/fool-app-tools/src/catalogue_test.rs
use super::*;
use fool_mcp_server::ToolDescriptor;
use serde_json::json;

fn descriptor(name: &str) -> ToolDescriptor {
    ToolDescriptor {
        name: name.into(),
        description: "for the test".into(),
        input_schema: json!({"type": "object", "properties": {}}),
    }
}

#[test]
fn an_empty_catalogue_advertises_nothing() {
    assert!(Catalogue::new().tools().is_empty());
}

#[test]
fn registering_replaces_rather_than_appends() {
    let catalogue = Catalogue::new();
    catalogue.replace(vec![descriptor("app_theme"), descriptor("app_settings")]);
    catalogue.replace(vec![descriptor("app_theme")]);
    let names: Vec<String> = catalogue.tools().into_iter().map(|t| t.name).collect();
    assert_eq!(names, vec!["app_theme".to_string()]);
}
```

The second test is the one that matters: a renderer reloads, registers again, and a catalogue that
appended would advertise every tool twice and the model would see duplicates.

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd backend/core && cargo test -p fool-app-tools catalogue`
Expected: FAIL — `Catalogue` not found.

- [ ] **Step 3: Write the catalogue**

```rust
// backend/core/crates/fool-app-tools/src/catalogue.rs
use std::sync::RwLock;

use fool_mcp_server::ToolDescriptor;

/// What the application says it can do.
///
/// Owned by the renderer, which registers it at startup, because the schemas are
/// written in TypeScript beside the handlers that implement them. Copying them
/// into Rust would create a second definition of the same tool and they would
/// drift on the first edit.
pub struct Catalogue {
    tools: RwLock<Vec<ToolDescriptor>>,
}

impl Catalogue {
    pub fn new() -> Self {
        Self {
            tools: RwLock::new(Vec::new()),
        }
    }

    pub fn replace(&self, tools: Vec<ToolDescriptor>) {
        *self.tools.write().expect("catalogue lock") = tools;
    }

    pub fn tools(&self) -> Vec<ToolDescriptor> {
        self.tools.read().expect("catalogue lock").clone()
    }
}

impl Default for Catalogue {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
#[path = "catalogue_test.rs"]
mod catalogue_test;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend/core && cargo test -p fool-app-tools catalogue`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the failing host test**

```rust
// backend/core/crates/fool-app-tools/src/host_test.rs
use super::*;
use fool_api_types::{APP_TOOL_REQUEST_EVENT, AppToolResult, WebSocketMessage};
use fool_realtime::EventBroadcaster;
use fool_mcp_server::{McpToolHost, ToolDescriptor};
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Default)]
struct SpyBroadcaster {
    sent: Mutex<Vec<WebSocketMessage<serde_json::Value>>>,
}

impl EventBroadcaster for SpyBroadcaster {
    fn broadcast(&self, event: WebSocketMessage<serde_json::Value>) {
        self.sent.lock().expect("spy lock").push(event);
    }
}

#[tokio::test]
async fn calling_a_tool_broadcasts_a_request_and_returns_the_answer() {
    let catalogue = Arc::new(Catalogue::new());
    let pending = Arc::new(PendingCalls::new(Duration::from_secs(5)));
    let spy = Arc::new(SpyBroadcaster::default());
    let host = AppToolHost::new(catalogue, pending.clone(), spy.clone(), "c1".into());

    let call = tokio::spawn(async move { host.call_tool("app_look_at_screen", json!({})).await });
    tokio::task::yield_now().await;

    let sent = spy.sent.lock().expect("spy lock").clone();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].name, APP_TOOL_REQUEST_EVENT);
    let call_id = sent[0].data["call_id"].as_str().unwrap().to_string();

    pending.resolve(AppToolResult {
        call_id,
        ok: true,
        content: "a browser".into(),
    });
    assert_eq!(call.await.unwrap(), Ok("a browser".to_string()));
}

#[tokio::test]
async fn a_tool_nobody_answers_returns_an_error_the_model_can_say() {
    let host = AppToolHost::new(
        Arc::new(Catalogue::new()),
        Arc::new(PendingCalls::new(Duration::from_millis(20))),
        Arc::new(SpyBroadcaster::default()),
        "c1".into(),
    );
    let result = host.call_tool("app_look_at_screen", json!({})).await;
    assert_eq!(
        result,
        Err("The application did not answer in time; the action was not carried out.".to_string())
    );
}

#[tokio::test]
async fn the_advertised_tools_are_the_registered_ones() {
    let catalogue = Arc::new(Catalogue::new());
    catalogue.replace(vec![ToolDescriptor {
        name: "app_theme".into(),
        description: "Change how the app looks".into(),
        input_schema: json!({"type": "object", "properties": {}}),
    }]);
    let host = AppToolHost::new(
        catalogue,
        Arc::new(PendingCalls::new(Duration::from_secs(5))),
        Arc::new(SpyBroadcaster::default()),
        "c1".into(),
    );
    assert_eq!(host.list_tools().await[0].name, "app_theme");
}
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `cd backend/core && cargo test -p fool-app-tools host`
Expected: FAIL — `AppToolHost` not found.

- [ ] **Step 7: Write the host**

```rust
// backend/core/crates/fool-app-tools/src/host.rs
use std::sync::Arc;

use async_trait::async_trait;
use fool_api_types::{APP_TOOL_REQUEST_EVENT, AppToolRequest, WebSocketMessage};
use fool_mcp_server::{McpToolHost, ToolDescriptor};
use fool_realtime::EventBroadcaster;
use serde_json::Value;

use crate::catalogue::Catalogue;
use crate::pending::PendingCalls;

/// The message a model is given when the application does not answer.
///
/// Written as something it can repeat out loud, and written as a failure rather
/// than as an absence, because a tool that returns nothing is read by a model as
/// a tool that worked.
const NO_ANSWER: &str = "The application did not answer in time; the action was not carried out.";

/// An MCP host that performs no work itself.
pub struct AppToolHost {
    catalogue: Arc<Catalogue>,
    pending: Arc<PendingCalls>,
    broadcaster: Arc<dyn EventBroadcaster>,
    conversation_id: String,
}

impl AppToolHost {
    pub fn new(
        catalogue: Arc<Catalogue>,
        pending: Arc<PendingCalls>,
        broadcaster: Arc<dyn EventBroadcaster>,
        conversation_id: String,
    ) -> Self {
        Self {
            catalogue,
            pending,
            broadcaster,
            conversation_id,
        }
    }
}

#[async_trait]
impl McpToolHost for AppToolHost {
    async fn list_tools(&self) -> Vec<ToolDescriptor> {
        self.catalogue.tools()
    }

    async fn call_tool(&self, name: &str, arguments: Value) -> Result<String, String> {
        let call_id = uuid::Uuid::new_v4().to_string();
        let request = AppToolRequest {
            conversation_id: self.conversation_id.clone(),
            call_id: call_id.clone(),
            name: name.to_string(),
            arguments,
        };
        let payload = serde_json::to_value(&request).map_err(|error| error.to_string())?;
        self.broadcaster
            .broadcast(WebSocketMessage::new(APP_TOOL_REQUEST_EVENT, payload));

        match self.pending.issue(call_id).await {
            Ok(result) if result.ok => Ok(result.content),
            Ok(result) => Err(result.content),
            Err(_) => Err(NO_ANSWER.to_string()),
        }
    }
}

/// Hands out a host bound to whichever conversation the call arrived for.
///
/// One instance for the whole application; the conversation id is the last
/// path segment, which is what the session's MCP URL was built with.
pub struct AppToolHosts {
    catalogue: Arc<Catalogue>,
    pending: Arc<PendingCalls>,
    broadcaster: Arc<dyn EventBroadcaster>,
}

impl AppToolHosts {
    pub fn new(
        catalogue: Arc<Catalogue>,
        pending: Arc<PendingCalls>,
        broadcaster: Arc<dyn EventBroadcaster>,
    ) -> Self {
        Self {
            catalogue,
            pending,
            broadcaster,
        }
    }
}

impl HostResolver for AppToolHosts {
    fn resolve(&self, path: &str) -> Option<Arc<dyn McpToolHost>> {
        let conversation_id = path.strip_prefix("/mcp/")?.trim_end_matches('/');
        if conversation_id.is_empty() {
            return None;
        }
        Some(Arc::new(AppToolHost::new(
            self.catalogue.clone(),
            self.pending.clone(),
            self.broadcaster.clone(),
            conversation_id.to_owned(),
        )))
    }
}

#[cfg(test)]
#[path = "host_test.rs"]
mod host_test;
```

Add two tests for the resolver to `host_test.rs`:

```rust
#[test]
fn the_conversation_id_comes_from_the_path() {
    let hosts = AppToolHosts::new(
        Arc::new(Catalogue::new()),
        Arc::new(PendingCalls::new(Duration::from_secs(5))),
        Arc::new(SpyBroadcaster::default()),
    );
    assert!(hosts.resolve("/mcp/conversation-7").is_some());
}

#[test]
fn a_path_without_a_conversation_resolves_to_nothing() {
    let hosts = AppToolHosts::new(
        Arc::new(Catalogue::new()),
        Arc::new(PendingCalls::new(Duration::from_secs(5))),
        Arc::new(SpyBroadcaster::default()),
    );
    assert!(hosts.resolve("/mcp/").is_none());
    assert!(hosts.resolve("/health").is_none());
}
```

Add `uuid = { workspace = true }` to the crate's dependencies, and export the new modules:

```rust
// backend/core/crates/fool-app-tools/src/lib.rs
pub mod catalogue;
pub mod host;
pub mod pending;

pub use catalogue::Catalogue;
pub use host::{AppToolHost, AppToolHosts};
pub use pending::{PendingCalls, PendingError};
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd backend/core && cargo test -p fool-app-tools`
Expected: PASS, 10 tests — three from `pending`, two from `catalogue`, three from `host`, two from
the resolver.

- [ ] **Step 9: Commit**

```bash
git add backend/core/crates/fool-app-tools
git commit -m "feat(app-tools): forward a tool call to the application and wait for the answer"
```

---

### Task 5: The two HTTP routes the renderer uses

**Files:**
- Create: `backend/core/crates/fool-app-tools/src/routes.rs`
- Create: `backend/core/crates/fool-app-tools/src/routes_test.rs`
- Modify: `backend/core/crates/fool-app-tools/src/lib.rs`
- Modify: `backend/core/crates/fool-app-tools/Cargo.toml` (add `axum`)

**Interfaces:**
- Consumes: `Catalogue`, `PendingCalls`.
- Produces: `pub fn router(state: AppToolsState) -> axum::Router`, `pub struct AppToolsState { pub catalogue: Arc<Catalogue>, pub pending: Arc<PendingCalls> }`, serving `POST /api/app-tools/catalogue` and `POST /api/app-tools/result`.

- [ ] **Step 1: Write the failing tests**

```rust
// backend/core/crates/fool-app-tools/src/routes_test.rs
use super::*;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use tower::ServiceExt;

fn state() -> AppToolsState {
    AppToolsState {
        catalogue: Arc::new(Catalogue::new()),
        pending: Arc::new(PendingCalls::new(Duration::from_secs(5))),
    }
}

#[tokio::test]
async fn registering_a_catalogue_stores_it() {
    let state = state();
    let app = router(state.clone());
    let body = json!({"tools": [{"name": "app_theme", "description": "d", "inputSchema": {}}]});
    let response = app
        .oneshot(
            Request::post("/api/app-tools/catalogue")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(state.catalogue.tools()[0].name, "app_theme");
}

#[tokio::test]
async fn a_result_for_nothing_pending_is_accepted_and_ignored() {
    let app = router(state());
    let body = json!({"call_id": "gone", "ok": true, "content": "late"});
    let response = app
        .oneshot(
            Request::post("/api/app-tools/result")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}
```

The second test encodes a decision: a late answer — one that arrives after its deadline — is not an
error for the renderer to handle. It has nowhere useful to go and the agent has already been told the
call failed.

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd backend/core && cargo test -p fool-app-tools routes`
Expected: FAIL — `router` not found.

- [ ] **Step 3: Write the routes**

```rust
// backend/core/crates/fool-app-tools/src/routes.rs
use std::sync::Arc;

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use fool_api_types::AppToolResult;
use fool_mcp_server::ToolDescriptor;
use serde::Deserialize;

use crate::catalogue::Catalogue;
use crate::pending::PendingCalls;

#[derive(Clone)]
pub struct AppToolsState {
    pub catalogue: Arc<Catalogue>,
    pub pending: Arc<PendingCalls>,
}

#[derive(Deserialize)]
pub struct CatalogueBody {
    pub tools: Vec<ToolDescriptor>,
}

/// Mirrors the shape used by `fool-conversation`'s confirmation routes: one
/// path to send something in, one to answer with.
pub fn router(state: AppToolsState) -> Router {
    Router::new()
        .route("/api/app-tools/catalogue", post(register_catalogue))
        .route("/api/app-tools/result", post(receive_result))
        .with_state(state)
}

async fn register_catalogue(State(state): State<AppToolsState>, Json(body): Json<CatalogueBody>) {
    state.catalogue.replace(body.tools);
}

async fn receive_result(State(state): State<AppToolsState>, Json(result): Json<AppToolResult>) {
    // Deliberately ignoring the return: a result whose call has already timed
    // out has nowhere to go, and the renderer cannot do anything about it.
    let _ = state.pending.resolve(result);
}

#[cfg(test)]
#[path = "routes_test.rs"]
mod routes_test;
```

`ToolDescriptor` needs `Deserialize` for this; add it to the derive list in
`backend/core/crates/fool-mcp-server/src/host.rs`. Add `axum`, `serde` and dev-dependency `tower` to
`fool-app-tools/Cargo.toml`, and `pub mod routes;` plus `pub use routes::{AppToolsState, router};` to
its `lib.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend/core && cargo test -p fool-app-tools`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/core/crates/fool-app-tools backend/core/crates/fool-mcp-server
git commit -m "feat(app-tools): routes for registering a catalogue and answering a call"
```

---

### Task 6: Start the server and give it to a session

**Files:**
- Modify: `backend/core/crates/fool-app/src/router/routes.rs` (mount the router)
- Modify: `backend/core/crates/fool-app/src/router/state.rs` (hold the state and the port/token)
- Modify: `backend/core/crates/fool-ai-agent/src/factory/foolrs.rs:754-780` (`resolve_mcp_servers`)
- Create: `backend/core/crates/fool-ai-agent/src/factory/app_tools_test.rs`

**Interfaces:**
- Consumes: `AppToolsState`, `router`, `AppToolHost`, `serve_http`.
- Produces: `pub const APP_TOOLS_MCP_SERVER_NAME: &str = "fool-app";` in `fool-api-types`, and an entry in the map `resolve_mcp_servers` returns.

- [ ] **Step 1: Write the failing injection test**

```rust
// backend/core/crates/fool-ai-agent/src/factory/app_tools_test.rs
use super::*;

#[test]
fn every_foolrs_session_is_given_the_app_tools_server() {
    let overrides = FoolrsBuildExtra {
        app_tools_mcp: Some(AppToolsMcpConfig {
            port: 41234,
            token: "t".into(),
        }),
        ..Default::default()
    };
    let servers = resolve_mcp_servers(&overrides, "conversation-7");
    let server = &servers[APP_TOOLS_MCP_SERVER_NAME];
    assert!(matches!(server.transport, TransportType::StreamableHttp));
    assert_eq!(server.url.as_deref(), Some("http://127.0.0.1:41234/mcp/conversation-7"));
    assert_eq!(server.deferred, Some(false));
}

#[test]
fn a_session_without_app_tools_configured_gets_none() {
    let servers = resolve_mcp_servers(&FoolrsBuildExtra::default(), "conversation-7");
    assert!(!servers.contains_key(APP_TOOLS_MCP_SERVER_NAME));
}
```

`deferred: Some(false)` is asserted deliberately: the app's own tools are the ones a spoken
conversation reaches for first, and a deferred server would make the model search before it could
look at the screen.

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd backend/core && cargo test -p fool-ai-agent app_tools`
Expected: FAIL — `AppToolsMcpConfig` not found.

- [ ] **Step 3: Add the config type and the injection**

Add to `backend/core/crates/fool-api-types/src/app_tool.rs`:

```rust
pub const APP_TOOLS_MCP_SERVER_NAME: &str = "fool-app";

/// Where the in-process app-tools MCP server is listening, for a session that
/// is about to be built.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppToolsMcpConfig {
    pub port: u16,
    pub token: String,
}
```

Add `pub app_tools_mcp: Option<AppToolsMcpConfig>` to `FoolrsBuildExtra`, then extend
`resolve_mcp_servers` in `backend/core/crates/fool-ai-agent/src/factory/foolrs.rs`:

```rust
fn resolve_mcp_servers(overrides: &FoolrsBuildExtra, conversation_id: &str) -> HashMap<String, McpServerConfig> {
    let mut servers = HashMap::new();
    if let Some(cfg) = &overrides.team_mcp_stdio_config {
        servers.extend(team_mcp_to_config(cfg));
    }
    if let Some(cfg) = &overrides.app_tools_mcp {
        servers.extend(app_tools_to_config(cfg, conversation_id));
    }
    servers
}

/// The application's own capabilities, over HTTP rather than a stdio bridge.
///
/// `foolrs` is embedded in the same process as the server, so there is nothing
/// to proxy: a bridge would exist only to be spawned and killed. A hosted CLI
/// agent still needs one, and gets it separately.
fn app_tools_to_config(cfg: &AppToolsMcpConfig, conversation_id: &str) -> HashMap<String, McpServerConfig> {
    let mut headers = HashMap::new();
    headers.insert("Authorization".to_owned(), format!("Bearer {}", cfg.token));

    let server = McpServerConfig {
        transport: TransportType::StreamableHttp,
        command: None,
        args: None,
        env: None,
        // The conversation is named in the path: one listener, many
        // conversations, and a call that knows which one it belongs to.
        url: Some(format!("http://127.0.0.1:{}/mcp/{}", cfg.port, conversation_id)),
        headers: Some(headers),
        deferred: Some(false),
        startup_timeout_ms: None,
    };

    HashMap::from([(APP_TOOLS_MCP_SERVER_NAME.to_owned(), server)])
}

#[cfg(test)]
#[path = "app_tools_test.rs"]
mod app_tools_test;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend/core && cargo test -p fool-ai-agent app_tools`
Expected: PASS, 2 tests.

- [ ] **Step 5: Start the server at application startup**

```rust
// backend/core/crates/fool-app/src/router/state.rs
use std::sync::Arc;
use std::time::Duration;

use fool_api_types::AppToolsMcpConfig;
use fool_app_tools::{AppToolHosts, AppToolsState, Catalogue, PendingCalls};
use fool_mcp_server::serve_http;
use fool_realtime::EventBroadcaster;
use tokio::net::TcpListener;
use tokio::sync::watch;

/// Long enough for a screen capture and a model to describe what it saw; short
/// enough that a wedged renderer does not hold a spoken conversation open for
/// minutes. The deadline is what turns "no answer" into a sentence the
/// assistant can say.
const APP_TOOL_DEADLINE: Duration = Duration::from_secs(60);

pub async fn start_app_tools(
    broadcaster: Arc<dyn EventBroadcaster>,
) -> std::io::Result<(AppToolsState, AppToolsMcpConfig)> {
    let catalogue = Arc::new(Catalogue::new());
    let pending = Arc::new(PendingCalls::new(APP_TOOL_DEADLINE));
    let token = uuid::Uuid::now_v7().to_string();

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    // Held for the life of the process: the server stops when the app does.
    let (_shutdown_tx, shutdown_rx) = watch::channel(false);
    let hosts = Arc::new(AppToolHosts::new(catalogue.clone(), pending.clone(), broadcaster));
    tokio::spawn(serve_http(listener, token.clone(), hosts, shutdown_rx));

    Ok((
        AppToolsState { catalogue, pending },
        AppToolsMcpConfig { port, token },
    ))
}
```

Hold the returned `AppToolsMcpConfig` on the router state so session construction can read it, and
merge the routes into the app router beside the existing `.route("/health", …)` in
`backend/core/crates/fool-app/src/router/routes.rs`:

```rust
let app = app.merge(fool_app_tools::router(app_tools_state.clone()));
```

- [ ] **Step 6: Run the whole backend suite**

Run: `cd backend/core && cargo test`
Expected: PASS, with the team suite unchanged.

- [ ] **Step 7: Commit**

```bash
git add backend/core/crates
git commit -m "feat(app-tools): serve the application's own tools to every session"
```

---

### Task 7: The renderer answers

**Files:**
- Create: `packages/desktop/src/renderer/services/appTools/appToolChannel.ts`
- Create: `tests/unit/renderer/appTools/appToolChannel.test.ts`
- Create: `packages/desktop/src/renderer/services/appTools/toolDescriptors.ts`
- Create: `tests/unit/renderer/appTools/toolDescriptors.test.ts`
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts` (one ws emitter, two posts)

**Interfaces:**
- Consumes: `REALTIME_TOOLS` from `@/common/realtime`, `runVoiceTool` from `@renderer/pages/voice/runtime/toolRunner`.
- Produces: `describeAppTools(): ToolDescriptor[]`, `startAppToolChannel(): () => void`.
- Note: `ToolHost` (from `@renderer/pages/voice/runtime/types`) has exactly eight members — `t`,
  `updateActivity`, `backToListening`, `flushOutput`, `setStandby`, `startWorkingHeartbeat`,
  `setSessionRule`, `dropSessionRule` — and `ToolInvocation` is `{ callId, name, argumentsJson }`.

- [ ] **Step 1: Write the failing descriptor test**

```ts
// tests/unit/renderer/appTools/toolDescriptors.test.ts
import { describe, expect, it } from 'vitest';
import { describeAppTools } from '@renderer/services/appTools/toolDescriptors';

describe('describeAppTools', () => {
  it('describes every realtime tool once', () => {
    const names = describeAppTools().map((tool) => tool.name);
    expect(names).toContain('app_look_at_screen');
    expect(new Set(names).size).toBe(names.length);
  });

  it('sends the schema under the key MCP expects', () => {
    const [first] = describeAppTools();
    expect(first.inputSchema).toEqual(expect.objectContaining({ type: 'object' }));
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bunx vitest run --maxWorkers=2 tests/unit/renderer/appTools/toolDescriptors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the descriptors**

```ts
// packages/desktop/src/renderer/services/appTools/toolDescriptors.ts
import { REALTIME_TOOLS } from '@/common/realtime';

/** One tool as an MCP server advertises it. */
export type ToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * The app's own tools, in the shape MCP asks for.
 *
 * Derived from `REALTIME_TOOLS` rather than written again, because those
 * descriptions are the ones the handlers were written against and a second copy
 * would drift on the first edit.
 */
export const describeAppTools = (): ToolDescriptor[] =>
  REALTIME_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters as Record<string, unknown>,
  }));
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bunx vitest run --maxWorkers=2 tests/unit/renderer/appTools/toolDescriptors.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the failing channel test**

```ts
// tests/unit/renderer/appTools/appToolChannel.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listeners: ((message: unknown) => void)[] = [];
const postResult = vi.fn(async () => undefined);
const postCatalogue = vi.fn(async () => undefined);
const runVoiceTool = vi.fn(async () => ({ ok: true, screen: 'a browser' }));

vi.mock('@/common', () => ({
  ipcBridge: {
    appTools: {
      request: { on: (fn: (message: unknown) => void) => { listeners.push(fn); return () => undefined; } },
      result: { invoke: postResult },
      catalogue: { invoke: postCatalogue },
    },
  },
}));
vi.mock('@renderer/pages/voice/runtime/toolRunner', () => ({ runVoiceTool }));

import { startAppToolChannel } from '@renderer/services/appTools/appToolChannel';

describe('startAppToolChannel', () => {
  beforeEach(() => {
    listeners.length = 0;
    postResult.mockClear();
    runVoiceTool.mockClear();
  });

  it('registers the catalogue when it starts', () => {
    startAppToolChannel();
    expect(postCatalogue).toHaveBeenCalled();
  });

  it('runs the tool and posts the result back', async () => {
    startAppToolChannel();
    await listeners[0]({ conversation_id: 'c1', call_id: 'call-1', name: 'app_look_at_screen', arguments: {} });
    expect(runVoiceTool).toHaveBeenCalled();
    expect(postResult).toHaveBeenCalledWith(
      expect.objectContaining({ call_id: 'call-1', ok: true })
    );
  });

  it('posts a failure rather than nothing when the handler throws', async () => {
    runVoiceTool.mockRejectedValueOnce(new Error('no screen'));
    startAppToolChannel();
    await listeners[0]({ conversation_id: 'c1', call_id: 'call-2', name: 'app_look_at_screen', arguments: {} });
    expect(postResult).toHaveBeenCalledWith(
      expect.objectContaining({ call_id: 'call-2', ok: false, content: 'no screen' })
    );
  });
});
```

The third test is the important one. A handler that throws and posts nothing is a call that times out
sixty seconds later, and the user hears a long silence instead of a short apology.

- [ ] **Step 6: Run it to make sure it fails**

Run: `bunx vitest run --maxWorkers=2 tests/unit/renderer/appTools/appToolChannel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Write the channel**

```ts
// packages/desktop/src/renderer/services/appTools/appToolChannel.ts
import { ipcBridge } from '@/common';
import { runVoiceTool } from '@renderer/pages/voice/runtime/toolRunner';
import { describeAppTools } from './toolDescriptors';

type AppToolRequest = {
  conversation_id: string;
  call_id: string;
  name: string;
  arguments: Record<string, unknown>;
};

/**
 * Answers an agent asking the application to do something.
 *
 * The work itself is `runVoiceTool`, unchanged: it was already the one place
 * that knows how to look at a screen or change a theme. What is new is that its
 * caller is now an agent rather than a spoken conversation, which is the whole
 * of this sub-project.
 *
 * Nothing here decides whether a tool is allowed to run; that belongs to the
 * permission layer and is a separate piece of work. This one only guarantees
 * that every request gets exactly one answer.
 */
export const startAppToolChannel = (): (() => void) => {
  void ipcBridge.appTools.catalogue.invoke({ tools: describeAppTools() });

  return ipcBridge.appTools.request.on(async (request: AppToolRequest) => {
    try {
      const result = await runVoiceTool(agentToolHost(request.conversation_id), {
        callId: request.call_id,
        name: request.name,
        argumentsJson: JSON.stringify(request.arguments ?? {}),
      });
      await ipcBridge.appTools.result.invoke({
        call_id: request.call_id,
        ok: result.ok !== false,
        content: JSON.stringify(result),
      });
    } catch (error) {
      // Always an answer. A thrown handler that posted nothing would leave the
      // agent waiting for the full deadline and the user listening to silence.
      await ipcBridge.appTools.result.invoke({
        call_id: request.call_id,
        ok: false,
        content: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
```

In the same file, above `startAppToolChannel`:

```ts
/**
 * What a tool handler is lent when its caller is an agent rather than a spoken
 * conversation.
 *
 * Most of `ToolHost` is about a conversation that is happening out loud — the
 * activity list beside the microphone, giving the floor back, the "still on it"
 * heartbeat. None of that exists here, and pretending otherwise would put rows
 * on a panel nobody is looking at. What does carry over is `t`, because a tool
 * that fails has to say so in the user's language wherever it was called from.
 */
const agentToolHost = (conversationId: string): ToolHost => ({
  t: (key, values) => i18next.t(key, values as never) as string,
  updateActivity: () => undefined,
  backToListening: () => undefined,
  flushOutput: () => undefined,
  setStandby: () => undefined,
  // Returns the stop function the contract requires; there is nobody to talk to
  // meanwhile, so it starts nothing.
  startWorkingHeartbeat: () => () => undefined,
  // A rule set from an agent turn would bind a spoken conversation that may not
  // exist. Rules the user wants kept go through the memory instead.
  setSessionRule: () => undefined,
  dropSessionRule: () => undefined,
});
```

`conversationId` is unused for now and is prefixed `_conversationId` per the project's unused-param
rule until the permission layer gives it a use. Add to `ipcBridge.ts`, beside the existing
confirmation entries:

```ts
appTools: {
  request: wsEmitter<AppToolRequest>('app.tool.request'),
  result: httpPost<void, AppToolResult>(() => '/api/app-tools/result', (p) => p),
  catalogue: httpPost<void, { tools: ToolDescriptor[] }>(() => '/api/app-tools/catalogue', (p) => p),
},
```

Call `startAppToolChannel()` once from the renderer's root effect, where the other long-lived
listeners are started.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bunx vitest run --maxWorkers=2 tests/unit/renderer/appTools/`
Expected: PASS, 5 tests.

- [ ] **Step 9: Typecheck and commit**

```bash
bunx tsc --noEmit
git add packages/desktop/src tests/unit/renderer/appTools
git commit -m "feat(app-tools): let an agent ask the application to do something"
```

---

### Task 8: Prove it end to end, and write down what it cost

**Files:**
- Create: `tests/e2e/specs/app-tools.e2e.ts`
- Create: `docs/specs/2026-08-08-one-harness-measurements.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the first row of the measurement table the merge is later judged against.

- [ ] **Step 1: Write the failing end-to-end spec**

```ts
// tests/e2e/specs/app-tools.e2e.ts
import { expect, test } from '../fixtures';

/**
 * The channel, proved from outside it.
 *
 * The unit tests show each half works. This shows the halves are connected: a
 * JSON-RPC call to the in-process server reaches the renderer's handler and
 * comes back with what the handler returned, through a real websocket and a
 * real HTTP post.
 */
test('the app advertises its own tools over MCP', async ({ app }) => {
  const window = await app.firstWindow();
  const tools = await window.evaluate(async () => {
    const { port, token } = window.__foolAppTools;
    const response = await fetch(`http://127.0.0.1:${port}/mcp/e2e`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const body = await response.json();
    return body.result.tools.map((tool: { name: string }) => tool.name);
  });
  expect(tools).toContain('app_look_at_screen');
});

test('a tool call reaches the renderer and comes back', async ({ app }) => {
  const window = await app.firstWindow();
  const answer = await window.evaluate(async () => {
    const { port, token } = window.__foolAppTools;
    const response = await fetch(`http://127.0.0.1:${port}/mcp/e2e`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'app_theme', arguments: { action: 'reset' } },
      }),
    });
    const body = await response.json();
    return body.result;
  });
  expect(answer.isError).toBe(false);
  expect(answer.content[0].text.length).toBeGreaterThan(0);
});
```

`app_theme` with `reset` is the tool used here rather than `app_look_at_screen`, because it needs no
screen-capture permission and changes nothing a later test would see. Expose `__foolAppTools` on the
window from the same place `startAppToolChannel()` is called, guarded by the test-only flag the
existing specs use — see `tests/e2e/specs/acp-agent.e2e.ts` for how the app is launched and how that
flag is set.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bunx playwright test tests/e2e/specs/app-tools.e2e.ts`
Expected: FAIL before Tasks 1–7 are in place; PASS after.

- [ ] **Step 3: Run the whole suite the way this project runs it**

Run: `bunx vitest run --maxWorkers=2`
Expected: the full count, exit 0. A short count with `Worker forks emitted error` and no `FAIL` line
is resource exhaustion, not a failure — rerun rather than investigate.

- [ ] **Step 4: Measure one call and write it down**

Time twenty `app_look_at_screen` calls through the channel and record the median and the worst. Write
`docs/specs/2026-08-08-one-harness-measurements.md` with the date, the machine, the exact command,
and the numbers. This file is where the gate in the design document (§9) will later be settled; it
starts here because the cost of the channel is the one number this plan can already produce.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/specs/app-tools.e2e.ts docs/specs/2026-08-08-one-harness-measurements.md
git commit -m "test(app-tools): prove the channel end to end, and record what it costs"
```

---

## What this plan does not do

Named here so nobody has to guess whether it was forgotten.

- The spoken turn still runs in the renderer. Moving it is steps 3 to 6 of the design and gets its
  own plan.
- Nothing here decides whether a tool is *allowed* to run. Permission rules, the sandbox choice and
  checkpoints are the next sub-project.
- A hosted CLI agent reaches the app-tools server only once the stdio bridge subcommand exists, in
  the shape of `mcp-team-stdio`. That is a small task and belongs with the typed-chat work in the
  next plan, because it has no consumer until then.
- The claim gate still guards only the local pipeline. It moves when there is a single output path
  to move it to.
