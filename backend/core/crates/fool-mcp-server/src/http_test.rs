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

fn request(id: u64, method: &str, params: Option<Value>) -> JsonRpcRequest {
    JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: Some(id),
        method: method.into(),
        params,
    }
}

#[tokio::test]
async fn tools_list_answers_with_the_hosts_catalogue() {
    let response = dispatch(Arc::new(EchoHost), request(1, "tools/list", None)).await;
    assert_eq!(response.result.unwrap()["tools"][0]["name"], "echo");
}

#[tokio::test]
async fn tools_call_returns_the_hosts_text() {
    let response = dispatch(
        Arc::new(EchoHost),
        request(2, "tools/call", Some(json!({"name": "echo", "arguments": {"say": "hello"}}))),
    )
    .await;
    let result = response.result.unwrap();
    assert_eq!(result["content"][0]["text"], "hello");
    assert_eq!(result["isError"], false);
}

#[tokio::test]
async fn a_failing_tool_is_a_result_not_a_protocol_error() {
    // The model has to be able to read what went wrong and say it out loud. A
    // JSON-RPC error would be swallowed by the client instead.
    let response = dispatch(
        Arc::new(EchoHost),
        request(3, "tools/call", Some(json!({"name": "nope", "arguments": {}}))),
    )
    .await;
    let result = response.result.unwrap();
    assert_eq!(result["isError"], true);
    assert_eq!(result["content"][0]["text"], "unknown tool nope");
}

#[tokio::test]
async fn a_call_without_a_name_is_an_invalid_params_error() {
    let response = dispatch(Arc::new(EchoHost), request(4, "tools/call", Some(json!({})))).await;
    assert_eq!(response.error.unwrap().code, crate::protocol::INVALID_PARAMS);
}

#[tokio::test]
async fn initialize_announces_the_tools_capability() {
    let response = dispatch(Arc::new(EchoHost), request(5, "initialize", None)).await;
    let result = response.result.unwrap();
    assert_eq!(result["protocolVersion"], crate::protocol::PROTOCOL_VERSION);
    assert!(result["capabilities"]["tools"].is_object());
}

#[tokio::test]
async fn an_unknown_method_is_an_error_not_a_panic() {
    let response = dispatch(Arc::new(EchoHost), request(6, "nonsense", None)).await;
    assert_eq!(response.error.unwrap().code, crate::protocol::METHOD_NOT_FOUND);
}

#[test]
fn the_content_length_is_read_from_the_headers() {
    let headers = "post /mcp/c1 http/1.1\r\ncontent-length: 42\r\nauthorization: bearer t";
    assert_eq!(content_length(headers), Some(42));
    assert_eq!(content_length("post / http/1.1\r\nhost: x"), None);
}

#[test]
fn the_path_is_the_second_word_of_the_request_line() {
    assert_eq!(request_path("POST /mcp/c1 HTTP/1.1\r\nhost: x"), "/mcp/c1");
    assert_eq!(request_path(""), "/");
}

#[test]
fn the_header_name_is_case_insensitive_and_the_token_is_not() {
    let headers = "POST /mcp/c1 HTTP/1.1\r\nAuthorization: Bearer AbC\r\nhost: 127.0.0.1";
    assert!(authorized(headers, "AbC"));
    // The token itself is compared byte for byte: a different case is a
    // different token, which is the whole point of generating one.
    assert!(!authorized(headers, "abc"));
    assert!(!authorized(headers, "ABC"));
}

#[test]
fn a_request_with_no_authorization_header_is_refused() {
    let headers = "POST /mcp/c1 HTTP/1.1\r\nhost: 127.0.0.1";
    assert!(!authorized(headers, "AbC"));
}

#[test]
fn a_token_that_is_merely_a_prefix_is_refused() {
    let headers = "POST /mcp/c1 HTTP/1.1\r\nauthorization: Bearer secret-value";
    assert!(!authorized(headers, "secret"));
}
