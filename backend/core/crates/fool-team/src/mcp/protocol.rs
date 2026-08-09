//! The team server's slice of the MCP protocol.
//!
//! JSON-RPC and the framing live in `fool-mcp-server`, because the application's
//! own tool server speaks the same wire and a second hand-rolled copy would
//! drift. What stays here is what is genuinely the team's: the name it calls
//! itself, and the readiness notification a bridge sends when its slot is up.

pub use fool_mcp_server::protocol::{
    INTERNAL_ERROR, INVALID_PARAMS, INVALID_REQUEST, JsonRpcError, JsonRpcRequest, JsonRpcResponse, METHOD_NOT_FOUND,
    PARSE_ERROR, PROTOCOL_VERSION, read_frame, read_request, write_frame, write_response,
};

use serde::{Deserialize, Serialize};

pub const SERVER_NAME: &str = "fool-team-mcp";
pub const SERVER_VERSION: &str = "1.0.0";

// ---------------------------------------------------------------------------
// MCP ready notification (W4-D24a)
//
// Bridge 在 TCP connect + initialize 成功后 fire-and-forget 发送一帧通知给
// TeamMcpServer，声明对应 slot 已就绪。扁平结构（非 JSON-RPC），格式：
//   { "type": "mcp_ready", "slot_id": "...", "auth_token": "..." }
// 事实来源：docs/teams/phase1/fool-audit.md §3.1 "MCP ready 握手"
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpReadyNotification {
    pub r#type: String,
    pub slot_id: String,
    pub auth_token: String,
}

impl McpReadyNotification {
    pub const TYPE: &'static str = "mcp_ready";

    pub fn new(slot_id: impl Into<String>, auth_token: impl Into<String>) -> Self {
        Self {
            r#type: Self::TYPE.to_string(),
            slot_id: slot_id.into(),
            auth_token: auth_token.into(),
        }
    }

    pub fn is_mcp_ready(json: &serde_json::Value) -> bool {
        json.get("type").and_then(|v| v.as_str()) == Some(Self::TYPE)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn success_response_serialization() {
        let resp = JsonRpcResponse::success(Some(json!(1)), serde_json::json!({"ok": true}));
        assert_eq!(resp.jsonrpc, "2.0");
        assert_eq!(resp.id, Some(json!(1)));
        assert!(resp.error.is_none());
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["result"]["ok"], true);
        assert!(json.get("error").is_none());
    }

    #[test]
    fn error_response_serialization() {
        let resp = JsonRpcResponse::error(Some(json!(2)), METHOD_NOT_FOUND, "not found");
        assert_eq!(resp.id, Some(json!(2)));
        assert!(resp.result.is_none());
        let err = resp.error.as_ref().unwrap();
        assert_eq!(err.code, METHOD_NOT_FOUND);
        assert_eq!(err.message, "not found");
    }

    #[test]
    fn error_response_null_id() {
        let resp = JsonRpcResponse::error(None, PARSE_ERROR, "parse error");
        assert!(resp.id.is_none());
    }

    #[test]
    fn request_deserialization() {
        let json = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
        let req: JsonRpcRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.method, "tools/list");
        assert_eq!(req.id, Some(json!(1)));
        assert!(req.params.is_none());
    }

    #[test]
    fn request_with_params() {
        let json =
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"test","arguments":{"key":"val"}}}"#;
        let req: JsonRpcRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.method, "tools/call");
        let params = req.params.unwrap();
        assert_eq!(params["name"], "test");
    }

    #[test]
    fn notification_without_id() {
        let json = r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#;
        let req: JsonRpcRequest = serde_json::from_str(json).unwrap();
        assert!(req.id.is_none());
        assert_eq!(req.method, "notifications/initialized");
    }

    #[tokio::test]
    async fn frame_roundtrip() {
        let payload = b"hello world";
        let mut buf = Vec::new();
        write_frame(&mut buf, payload).await.unwrap();

        assert_eq!(buf.len(), 4 + payload.len());
        let len = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]);
        assert_eq!(len as usize, payload.len());

        let mut cursor = std::io::Cursor::new(buf);
        let read_back = read_frame(&mut cursor).await.unwrap();
        assert_eq!(read_back, payload);
    }

    #[tokio::test]
    async fn request_response_roundtrip() {
        let req = JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id: Some(json!(1)),
            method: "tools/list".into(),
            params: None,
        };
        let mut buf = Vec::new();
        let data = serde_json::to_vec(&req).unwrap();
        write_frame(&mut buf, &data).await.unwrap();

        let mut cursor = std::io::Cursor::new(buf);
        let parsed = read_request(&mut cursor).await.unwrap();
        assert_eq!(parsed.method, "tools/list");
        assert_eq!(parsed.id, Some(json!(1)));
    }

    #[tokio::test]
    async fn oversized_frame_rejected() {
        let fake_len: u32 = 11 * 1024 * 1024;
        let mut buf = Vec::new();
        buf.extend_from_slice(&fake_len.to_be_bytes());
        buf.extend_from_slice(&[0u8; 64]);

        let mut cursor = std::io::Cursor::new(buf);
        let result = read_frame(&mut cursor).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
    }

    #[tokio::test]
    async fn empty_frame() {
        let mut buf = Vec::new();
        write_frame(&mut buf, &[]).await.unwrap();

        let mut cursor = std::io::Cursor::new(buf);
        let read_back = read_frame(&mut cursor).await.unwrap();
        assert!(read_back.is_empty());
    }

    #[test]
    fn mcp_ready_notification_roundtrip() {
        let original = McpReadyNotification::new("slot-123", "token-abc");
        let json = serde_json::to_string(&original).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["type"], "mcp_ready");
        assert_eq!(value["slot_id"], "slot-123");
        assert_eq!(value["auth_token"], "token-abc");

        let parsed: McpReadyNotification = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.r#type, "mcp_ready");
        assert_eq!(parsed.slot_id, "slot-123");
        assert_eq!(parsed.auth_token, "token-abc");
    }

    #[test]
    fn mcp_ready_notification_is_mcp_ready() {
        let positive = serde_json::json!({
            "type": "mcp_ready",
            "slot_id": "s",
            "auth_token": "t"
        });
        assert!(McpReadyNotification::is_mcp_ready(&positive));

        let wrong_type = serde_json::json!({ "type": "other" });
        assert!(!McpReadyNotification::is_mcp_ready(&wrong_type));

        let missing_type = serde_json::json!({ "slot_id": "s" });
        assert!(!McpReadyNotification::is_mcp_ready(&missing_type));

        let non_object = serde_json::json!("mcp_ready");
        assert!(!McpReadyNotification::is_mcp_ready(&non_object));
    }
}
