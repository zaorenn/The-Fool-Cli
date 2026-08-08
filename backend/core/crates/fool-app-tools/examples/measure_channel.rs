//! What one call through the channel costs.
//!
//! The design document makes the merge conditional on measured numbers rather
//! than on an argument, and this is the first of them: the overhead the channel
//! itself adds, with the renderer's own work stubbed out at zero. Anything the
//! merge later measures is this plus the handler.
//!
//! Run with:
//!
//! ```text
//! cargo run -p fool-app-tools --example measure_channel --release
//! ```

use std::sync::Arc;
use std::time::{Duration, Instant};

use fool_api_types::{APP_TOOL_REQUEST_EVENT, AppToolResult, WebSocketMessage};
use fool_app_tools::{AppToolHosts, AppToolsState, Catalogue, PendingCalls};
use fool_mcp_server::{ToolDescriptor, serve_http};
use fool_realtime::EventBroadcaster;
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

const CALLS: usize = 200;

/// Answers instantly, so what is left in the figure is transport and bookkeeping.
struct InstantRenderer {
    pending: Arc<PendingCalls>,
}

impl EventBroadcaster for InstantRenderer {
    fn broadcast(&self, event: WebSocketMessage<Value>) {
        if event.name != APP_TOOL_REQUEST_EVENT {
            return;
        }
        let call_id = event.data["call_id"].as_str().unwrap_or_default().to_string();
        let pending = self.pending.clone();
        tokio::spawn(async move {
            pending.resolve(AppToolResult {
                call_id,
                ok: true,
                content: "done".into(),
            });
        });
    }
}

async fn one_call(port: u16, token: &str) -> Duration {
    let started = Instant::now();
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.expect("connect");
    let payload = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                         "params": {"name": "app_look_at_screen", "arguments": {}}})
    .to_string();
    let request = format!(
        "POST /mcp/measure HTTP/1.1\r\nhost: 127.0.0.1\r\nauthorization: Bearer {token}\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{payload}",
        payload.len()
    );
    stream.write_all(request.as_bytes()).await.expect("write");
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.expect("read");
    started.elapsed()
}

#[tokio::main]
async fn main() {
    let catalogue = Arc::new(Catalogue::new());
    catalogue.replace(vec![ToolDescriptor {
        name: "app_look_at_screen".into(),
        description: "measured".into(),
        input_schema: json!({"type": "object", "properties": {}}),
    }]);
    let pending = Arc::new(PendingCalls::new(Duration::from_secs(5)));
    let state = AppToolsState {
        catalogue: catalogue.clone(),
        pending: pending.clone(),
    };
    let _ = &state;

    let renderer = Arc::new(InstantRenderer {
        pending: pending.clone(),
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let token = "measure";
    let hosts = Arc::new(AppToolHosts::new(catalogue, pending, renderer));
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    std::mem::forget(shutdown_tx);
    tokio::spawn(serve_http(listener, token.to_string(), hosts, shutdown_rx));

    // Warm the runtime before anything is recorded: the first connection pays
    // for allocations every later one reuses.
    for _ in 0..20 {
        one_call(port, token).await;
    }

    let mut timings: Vec<Duration> = Vec::with_capacity(CALLS);
    for _ in 0..CALLS {
        timings.push(one_call(port, token).await);
    }
    timings.sort();

    let micros = |d: Duration| d.as_secs_f64() * 1_000.0;
    println!("calls        {CALLS}");
    println!("median       {:.3} ms", micros(timings[CALLS / 2]));
    println!("p95          {:.3} ms", micros(timings[CALLS * 95 / 100]));
    println!("worst        {:.3} ms", micros(timings[CALLS - 1]));
}
