use super::*;

#[test]
fn success_response_carries_the_request_id() {
    let response = JsonRpcResponse::success(Some(7), serde_json::json!({"ok": true}));
    assert_eq!(response.id, Some(7));
    assert_eq!(response.jsonrpc, "2.0");
    assert!(response.error.is_none());
    let json = serde_json::to_value(&response).unwrap();
    assert_eq!(json["result"]["ok"], true);
    assert!(json.get("error").is_none());
}

#[test]
fn error_response_carries_the_code_and_no_result() {
    let response = JsonRpcResponse::error(Some(1), METHOD_NOT_FOUND, "no such method");
    assert_eq!(response.error.as_ref().map(|error| error.code), Some(METHOD_NOT_FOUND));
    assert!(response.result.is_none());
}

#[test]
fn an_error_before_the_id_was_read_has_none() {
    let response = JsonRpcResponse::error(None, PARSE_ERROR, "parse error");
    assert!(response.id.is_none());
}

#[test]
fn a_request_without_params_parses() {
    let request: JsonRpcRequest = serde_json::from_str(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#).unwrap();
    assert_eq!(request.method, "tools/list");
    assert_eq!(request.id, Some(1));
    assert!(request.params.is_none());
}

#[test]
fn a_notification_has_no_id() {
    let request: JsonRpcRequest =
        serde_json::from_str(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).unwrap();
    assert!(request.id.is_none());
    assert_eq!(request.method, "notifications/initialized");
}

#[tokio::test]
async fn a_frame_survives_a_round_trip() {
    let payload = b"hello world";
    let mut buffer = Vec::new();
    write_frame(&mut buffer, payload).await.unwrap();

    assert_eq!(buffer.len(), 4 + payload.len());
    let length = u32::from_be_bytes([buffer[0], buffer[1], buffer[2], buffer[3]]);
    assert_eq!(length as usize, payload.len());

    let mut cursor = std::io::Cursor::new(buffer);
    assert_eq!(read_frame(&mut cursor).await.unwrap(), payload);
}

#[tokio::test]
async fn a_request_survives_a_round_trip() {
    let request = JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: Some(1),
        method: "tools/list".into(),
        params: None,
    };
    let mut buffer = Vec::new();
    write_frame(&mut buffer, &serde_json::to_vec(&request).unwrap())
        .await
        .unwrap();

    let mut cursor = std::io::Cursor::new(buffer);
    let parsed = read_request(&mut cursor).await.unwrap();
    assert_eq!(parsed.method, "tools/list");
    assert_eq!(parsed.id, Some(1));
}

#[tokio::test]
async fn an_oversized_frame_is_refused_rather_than_allocated() {
    let claimed: u32 = 11 * 1024 * 1024;
    let mut buffer = Vec::new();
    buffer.extend_from_slice(&claimed.to_be_bytes());
    buffer.extend_from_slice(&[0_u8; 64]);

    let mut cursor = std::io::Cursor::new(buffer);
    let error = read_frame(&mut cursor).await.unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
}

#[tokio::test]
async fn an_empty_frame_is_a_frame() {
    let mut buffer = Vec::new();
    write_frame(&mut buffer, &[]).await.unwrap();

    let mut cursor = std::io::Cursor::new(buffer);
    assert!(read_frame(&mut cursor).await.unwrap().is_empty());
}
