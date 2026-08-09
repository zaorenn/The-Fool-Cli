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

impl AppToolsMcpConfig {
    /// The subcommand that carries this server over stdio.
    ///
    /// An agent embedded in this process talks to the listener directly. A
    /// hosted CLI — Claude Code, Codex — is a separate process that speaks MCP
    /// over stdin and stdout and cannot be handed a port and a token, so it is
    /// spawned with this and the bridge does the talking.
    pub const BRIDGE_SUBCOMMAND: &'static str = "app-tools-bridge";

    /// env key the stdio bridge reads to learn the loopback port.
    pub const ENV_PORT: &'static str = "FOOL_APP_TOOLS_PORT";
    /// env key the stdio bridge reads to learn the bearer token.
    pub const ENV_TOKEN: &'static str = "FOOL_APP_TOOLS_TOKEN";
    /// env key the stdio bridge reads to learn which path — and therefore
    /// which conversation, and which half of the catalogue — it serves.
    pub const ENV_PATH: &'static str = "FOOL_APP_TOOLS_PATH";

    /// The tools a conversation reaches for first.
    pub fn core_path(conversation_id: &str) -> String {
        format!("/mcp/{conversation_id}")
    }

    /// The long tail, on its own path so a client that defers can defer it.
    pub fn rest_path(conversation_id: &str) -> String {
        format!("/mcp/rest/{conversation_id}")
    }
}

#[cfg(test)]
#[path = "app_tool_test.rs"]
mod app_tool_test;
