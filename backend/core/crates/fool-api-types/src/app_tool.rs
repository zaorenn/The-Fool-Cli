//! An agent asking the application to do something only the application can do.
//!
//! Looking at the screen, changing the theme, running a taught skill: the code
//! that does these lives in the renderer, beside the window it acts on. These
//! are the two messages that carry a call there and an answer back.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The websocket event name the renderer listens on.
pub const APP_TOOL_REQUEST_EVENT: &str = "app.tool.request";

/// The MCP server name a session sees for the application's own tools.
pub const APP_TOOLS_MCP_SERVER_NAME: &str = "fool-app";

/// One call, on its way out to the application.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppToolRequest {
    pub conversation_id: String,
    pub call_id: String,
    pub name: String,
    pub arguments: Value,
}

/// What came back.
///
/// `ok: false` is a real answer rather than a transport failure: the tool ran
/// and could not do it, and the model is told so in words it may repeat. The
/// distinction matters because a tool that returns nothing is read by a model
/// as a tool that worked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppToolResult {
    pub call_id: String,
    pub ok: bool,
    pub content: String,
}

/// Where the in-process app-tools MCP server is listening, for a session that
/// is about to be built.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppToolsMcpConfig {
    pub port: u16,
    pub token: String,
}

#[cfg(test)]
#[path = "app_tool_test.rs"]
mod app_tool_test;
