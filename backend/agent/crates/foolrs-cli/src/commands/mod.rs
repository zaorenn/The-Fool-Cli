//! Subcommand implementations for the `fool` CLI binary.
//!
//! This file is a façade — module declarations and re-export only.
//! All dispatch logic lives in `dispatch.rs`.

pub(crate) mod cmd_auth;
pub(crate) mod cmd_config;
pub(crate) mod cmd_mcp;
pub(crate) mod cmd_session;
pub(crate) mod cmd_skills;
pub(crate) mod dispatch;

pub(crate) use dispatch::dispatch;
