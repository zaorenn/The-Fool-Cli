use super::*;
use crate::commands::mcp::stdio;
use serde_json::json;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn port_of(server: &MockServer) -> String {
    server.address().port().to_string()
}

async fn drive(server: &MockServer, request: serde_json::Value, framing: Framing) -> String {
    let env = BridgeEnv::from_values(&port_of(server), "tok", "/mcp/conv-1").unwrap();
    let client = build_client().unwrap();
    let out = Mutex::new(Vec::<u8>::new());

    exchange(&client, &env, &out, serde_json::to_vec(&request).unwrap(), framing)
        .await
        .unwrap();

    String::from_utf8(out.into_inner()).unwrap()
}

#[test]
fn builds_the_url_from_port_and_path() {
    let env = BridgeEnv::from_values("4321", "tok", "/mcp/conv-1").unwrap();
    assert_eq!(env.url, "http://127.0.0.1:4321/mcp/conv-1");
    assert_eq!(env.token, "tok");
}

/// A path handed over without its leading slash is a typo, not a different
/// endpoint — and gluing it straight onto the authority would silently produce
/// a URL for a host that does not exist.
#[test]
fn a_path_without_a_leading_slash_still_names_a_path() {
    let env = BridgeEnv::from_values("4321", "tok", "mcp/conv-1").unwrap();
    assert_eq!(env.url, "http://127.0.0.1:4321/mcp/conv-1");
}

#[test]
fn rejects_an_invalid_port_with_a_stable_code() {
    let err = BridgeEnv::from_values("not-a-port", "tok", "/mcp/conv-1").unwrap_err();
    assert_eq!(err.code(), CliBoundaryCode::McpEnvInvalidPort);
    assert_eq!(err.exit_code(), std::process::ExitCode::from(2));
}

#[tokio::test]
async fn a_call_is_posted_with_the_token_and_its_answer_written_back() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/mcp/conv-1"))
        .and(header("authorization", "Bearer tok"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "jsonrpc": "2.0", "id": 7, "result": {"tools": []}
        })))
        .expect(1)
        .mount(&server)
        .await;

    let written = drive(
        &server,
        json!({"jsonrpc": "2.0", "id": 7, "method": "tools/list"}),
        Framing::Line,
    )
    .await;

    let parsed: Value = serde_json::from_str(written.trim()).unwrap();
    assert_eq!(parsed["id"], 7);
    assert_eq!(parsed["result"]["tools"], json!([]));
}

/// The answer goes back in the spelling the call arrived in. A client that
/// sent headers and got a bare line would read nothing at all.
#[tokio::test]
async fn the_answer_uses_the_framing_the_call_arrived_in() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"jsonrpc": "2.0", "id": 1, "result": {}})))
        .mount(&server)
        .await;

    let written = drive(
        &server,
        json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}),
        Framing::ContentLength,
    )
    .await;

    assert!(written.starts_with("Content-Length: "), "{written}");
}

/// A notification carries no id, so nothing is waiting for an answer and
/// writing one would be a message the client cannot match to any call.
#[tokio::test]
async fn a_notification_is_delivered_and_not_answered() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"jsonrpc": "2.0", "id": null, "result": {}})))
        .expect(1)
        .mount(&server)
        .await;

    let written = drive(
        &server,
        json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
        Framing::Line,
    )
    .await;

    assert!(written.is_empty(), "{written}");
}

/// An id that is a string is an id. It is echoed as it came, because the
/// client matches on it exactly.
#[tokio::test]
async fn a_string_id_is_carried_through() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"jsonrpc": "2.0", "id": "abc", "result": {}})))
        .mount(&server)
        .await;

    let written = drive(
        &server,
        json!({"jsonrpc": "2.0", "id": "abc", "method": "tools/list"}),
        Framing::Line,
    )
    .await;

    let parsed: Value = serde_json::from_str(written.trim()).unwrap();
    assert_eq!(parsed["id"], "abc");
}

/// When the server cannot be reached, the client still gets an answer. Silence
/// here would leave it waiting on that id until it gave up on the bridge, and
/// on every later call it made through it.
#[tokio::test]
async fn a_server_that_cannot_be_reached_still_produces_an_answer() {
    // A server that is started and immediately dropped leaves a port nothing
    // is listening on — the shape of the app having gone away.
    let port = {
        let server = MockServer::start().await;
        port_of(&server)
    };
    let env = BridgeEnv::from_values(&port, "tok", "/mcp/conv-1").unwrap();
    let client = build_client().unwrap();
    let out = Mutex::new(Vec::<u8>::new());

    exchange(
        &client,
        &env,
        &out,
        serde_json::to_vec(&json!({"jsonrpc": "2.0", "id": 3, "method": "tools/list"})).unwrap(),
        Framing::Line,
    )
    .await
    .unwrap();

    let written = String::from_utf8(out.into_inner()).unwrap();
    let parsed: Value = serde_json::from_str(written.trim()).unwrap();
    assert_eq!(parsed["id"], 3);
    assert!(parsed["error"]["message"].is_string(), "{written}");
}

/// A body that is not JSON cannot be forwarded, and the bridge says which
/// boundary it failed at rather than dying with a serde message.
#[tokio::test]
async fn a_frame_that_is_not_json_is_named_as_such() {
    let server = MockServer::start().await;
    let env = BridgeEnv::from_values(&port_of(&server), "tok", "/mcp/conv-1").unwrap();
    let client = build_client().unwrap();
    let out = Mutex::new(Vec::<u8>::new());

    let err = exchange(&client, &env, &out, b"not json".to_vec(), Framing::Line)
        .await
        .unwrap_err();

    assert_eq!(err.code(), CliBoundaryCode::McpStdinJsonInvalid);
}

/// The whole loop, over a real socket: what the client wrote goes out, and what
/// comes back can be read with the same reader the client would use.
#[tokio::test]
async fn the_read_post_write_loop_holds_over_a_socket() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"jsonrpc": "2.0", "id": 1, "result": {"ok": true}})),
        )
        .mount(&server)
        .await;

    let env = BridgeEnv::from_values(&port_of(&server), "tok", "/mcp/conv-1").unwrap();
    let client = build_client().unwrap();
    let out = Mutex::new(Vec::<u8>::new());

    let mut stdin = &br#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#[..];
    let message = stdio::read_message(&mut stdin, SUBCOMMAND).await.unwrap().unwrap();
    exchange(&client, &env, &out, message.body, message.framing)
        .await
        .unwrap();

    let mut cursor = std::io::Cursor::new(out.into_inner());
    let reply = stdio::read_message(&mut cursor, SUBCOMMAND).await.unwrap().unwrap();
    let parsed: Value = serde_json::from_slice(&reply.body).unwrap();
    assert_eq!(parsed["result"]["ok"], true);
}
