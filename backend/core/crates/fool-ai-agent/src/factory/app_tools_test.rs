use super::*;

fn listening() -> AppToolsMcpConfig {
    AppToolsMcpConfig {
        port: 41234,
        token: "t".into(),
    }
}

#[test]
fn a_session_is_given_the_app_tools_server_on_its_own_path() {
    let servers = resolve_mcp_servers(&FoolrsBuildExtra::default(), Some(&listening()), "conversation-7");
    let server = &servers[APP_TOOLS_MCP_SERVER_NAME];

    assert_eq!(server.transport, TransportType::StreamableHttp);
    assert_eq!(server.url.as_deref(), Some("http://127.0.0.1:41234/mcp/conversation-7"));
    // Never deferred: the model must not have to search before it can look at
    // the screen.
    assert_eq!(server.deferred, Some(false));
    assert_eq!(
        server.headers.as_ref().and_then(|headers| headers.get("Authorization")),
        Some(&"Bearer t".to_owned())
    );
}

#[test]
fn a_process_with_no_app_tools_server_injects_nothing() {
    let servers = resolve_mcp_servers(&FoolrsBuildExtra::default(), None, "conversation-7");
    assert!(!servers.contains_key(APP_TOOLS_MCP_SERVER_NAME));
}

#[test]
fn the_client_cannot_name_the_port_itself() {
    // The config is the process's own, so a request carrying one is ignored:
    // `FoolrsBuildExtra` has no field for it and never did.
    let overrides: FoolrsBuildExtra = serde_json::from_value(serde_json::json!({
        "backend": "foolrs",
        "app_tools_mcp": {"port": 1, "token": "stolen"}
    }))
    .unwrap();

    let servers = resolve_mcp_servers(&overrides, None, "conversation-7");
    assert!(!servers.contains_key(APP_TOOLS_MCP_SERVER_NAME));
}

#[test]
fn the_team_server_and_the_app_server_can_both_be_present() {
    let overrides = FoolrsBuildExtra {
        team_mcp_stdio_config: Some(TeamMcpStdioConfig {
            team_id: "team-42".into(),
            port: 9000,
            token: "tok".into(),
            slot_id: "slot-1".into(),
            binary_path: "/usr/bin/backend".into(),
        }),
        ..Default::default()
    };

    let servers = resolve_mcp_servers(&overrides, Some(&listening()), "conversation-7");
    assert!(servers.contains_key(TEAM_MCP_SERVER_NAME));
    assert!(servers.contains_key(APP_TOOLS_MCP_SERVER_NAME));
}

#[test]
fn a_conversation_can_be_confined_by_what_the_user_asked_for() {
    // Safe to take from the request because it can only ever narrow: the
    // default is the real machine, which is what this product exists to act on.
    let overrides: FoolrsBuildExtra =
        serde_json::from_value(serde_json::json!({ "backend": "foolrs", "confined_to": "D:/project" })).unwrap();

    assert_eq!(overrides.confined_to.as_deref(), Some("D:/project"));
}

#[test]
fn a_conversation_with_nothing_asked_for_is_not_confined() {
    let overrides: FoolrsBuildExtra = serde_json::from_value(serde_json::json!({ "backend": "foolrs" })).unwrap();
    assert!(overrides.confined_to.is_none());
}

#[test]
fn the_long_tail_is_advertised_as_deferred() {
    // The mechanism existed and nothing used it: `is_deferred` was on every
    // tool and no tool ever returned true. Measured cost of not using it: 3,237
    // prompt tokens on every single turn.
    let servers = resolve_mcp_servers(&FoolrsBuildExtra::default(), Some(&listening()), "conversation-7");
    let deferred = &servers[&format!("{APP_TOOLS_MCP_SERVER_NAME}-rest")];

    assert_eq!(deferred.deferred, Some(true));
    assert_eq!(
        deferred.url.as_deref(),
        Some("http://127.0.0.1:41234/mcp/rest/conversation-7")
    );
}

#[test]
fn the_core_half_is_never_deferred() {
    // A model that has to search before it can look at the screen is a model
    // that spends a round finding out it is allowed to answer.
    let servers = resolve_mcp_servers(&FoolrsBuildExtra::default(), Some(&listening()), "conversation-7");
    assert_eq!(servers[APP_TOOLS_MCP_SERVER_NAME].deferred, Some(false));
}
