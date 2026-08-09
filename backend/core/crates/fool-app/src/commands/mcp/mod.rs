//! The MCP bridges this binary can be spawned as.
//!
//! Each one stands between an agent process that speaks MCP over stdin and
//! stdout and something inside this application that does not: the team
//! server over TCP, the application's own tools over HTTP. They share the
//! framing in [`stdio`], because a client's spelling is the client's to choose
//! and every bridge has to read both.

pub(crate) mod app_tools_bridge;
pub(crate) mod stdio;
pub(crate) mod team_bridge;
pub(crate) mod team_stdio;

pub(crate) use app_tools_bridge::run_app_tools_bridge;
pub(crate) use team_bridge::run_mcp_bridge;
pub(crate) use team_stdio::run_team_stdio;
