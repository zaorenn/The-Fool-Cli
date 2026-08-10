use super::*;

#[test]
fn a_request_serialises_with_the_keys_the_renderer_reads() {
    let request = AppToolRequest {
        conversation_id: "c1".into(),
        call_id: "call-1".into(),
        name: "app_look_at_screen".into(),
        arguments: serde_json::json!({"question": "what is open"}),
        user_id: Some("system_default_user".into()),
    };
    let wire = serde_json::to_value(&request).unwrap();
    assert_eq!(wire["conversation_id"], "c1");
    assert_eq!(wire["call_id"], "call-1");
    assert_eq!(wire["name"], "app_look_at_screen");
    assert_eq!(wire["arguments"]["question"], "what is open");
}

/// The websocket bridge routes by this key and drops what has no user_id.
///
/// Without it every application tool call was discarded before it left the
/// process and came back to the model, sixty seconds later, as a failure.
#[test]
fn a_request_carries_the_user_the_bridge_routes_by() {
    let request = AppToolRequest {
        conversation_id: "c1".into(),
        call_id: "call-1".into(),
        name: "app_skill_do".into(),
        arguments: serde_json::json!({}),
        user_id: Some("system_default_user".into()),
    };

    let wire = serde_json::to_value(&request).unwrap();

    assert_eq!(wire["user_id"], "system_default_user");
}

/// Carried in the query so the two path helpers keep the shape every existing
/// caller, and the stdio bridge, already build.
#[test]
fn the_path_says_whose_renderer_should_answer() {
    let path = AppToolsMcpConfig::core_path("c1");

    assert_eq!(AppToolsMcpConfig::with_user(&path, Some("u1")), "/mcp/c1?user=u1");
    assert_eq!(AppToolsMcpConfig::with_user(&path, None), "/mcp/c1");
    assert_eq!(AppToolsMcpConfig::with_user(&path, Some("   ")), "/mcp/c1");
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
