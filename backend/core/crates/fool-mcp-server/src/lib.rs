//! One MCP server implementation, for every caller inside this application.
//!
//! The wire is here; the meaning is in whatever implements [`McpToolHost`].
//! Keeping them apart is what lets the team server and the application's own
//! tool server share a transport instead of each hand-rolling one.

pub mod host;
pub mod http;
pub mod protocol;

pub use host::{HostResolver, McpToolHost, ToolDescriptor};
pub use http::serve_http;
pub use protocol::{JsonRpcError, JsonRpcRequest, JsonRpcResponse};
