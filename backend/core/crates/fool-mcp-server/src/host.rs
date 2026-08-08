use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One tool as it is advertised to an agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDescriptor {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

/// Whatever actually performs the work behind an MCP server.
///
/// The server owns the wire; the host owns the meaning. Keeping them apart is
/// what lets two servers in this application share one transport.
#[async_trait]
pub trait McpToolHost: Send + Sync {
    async fn list_tools(&self) -> Vec<ToolDescriptor>;
    /// `Ok` is the tool's text result; `Err` is a message the model may repeat.
    async fn call_tool(&self, name: &str, arguments: Value) -> Result<String, String>;
}

/// Picks the host for one request, from the path it arrived on.
///
/// A single listener serves every conversation, and a tool call has to know
/// which one it belongs to — a permission decision is made per conversation,
/// not per application. The path is how a call says so, and an MCP client sends
/// whatever path it was configured with without having to understand it.
pub trait HostResolver: Send + Sync {
    fn resolve(&self, path: &str) -> Option<Arc<dyn McpToolHost>>;
}
