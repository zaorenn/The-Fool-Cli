use super::*;

#[test]
fn a_request_serialises_with_the_keys_the_renderer_reads() {
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
    assert_eq!(wire["arguments"]["question"], "what is open");
}

#[test]
fn a_failed_result_still_carries_its_call_id() {
    let parsed: AppToolResult =
        serde_json::from_str(r#"{"call_id":"call-1","ok":false,"content":"the screen cannot be read"}"#).unwrap();
    assert_eq!(parsed.call_id, "call-1");
    assert!(!parsed.ok);
    assert_eq!(parsed.content, "the screen cannot be read");
}

#[test]
fn an_unconfigured_server_has_no_port() {
    assert_eq!(AppToolsMcpConfig::default().port, 0);
    assert!(AppToolsMcpConfig::default().token.is_empty());
}
