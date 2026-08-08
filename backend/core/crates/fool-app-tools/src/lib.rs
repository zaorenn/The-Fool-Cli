//! The application's own capabilities, offered to an agent as MCP tools.
//!
//! Nothing here does any work. A call arrives over MCP, is broadcast to the
//! renderer — where the handlers that look at the screen and change the theme
//! already live — and the answer comes back over HTTP. What this crate
//! guarantees is that every call gets exactly one answer, including when the
//! answer is that there wasn't one.

pub mod catalogue;
pub mod host;
pub mod pending;

pub use catalogue::Catalogue;
pub use host::{AppToolHost, AppToolHosts};
pub use pending::{PendingCalls, PendingError};
