//! Subcommand implementations for the `foolcore` binary.
//!
//! This file is a façade — module declarations and re-exports only.
//! All logic lives in the submodules.

pub(crate) mod cmd_capabilities;
pub(crate) mod cmd_config;
pub(crate) mod cmd_diagnose;
pub(crate) mod cmd_doctor;
pub(crate) mod cmd_prepare_managed_resources;
pub(crate) mod cmd_server;
pub(crate) mod cmd_team;
pub(crate) mod config_capabilities;
pub(crate) mod diagnose_capabilities;
pub(crate) mod error;
pub(crate) mod mcp;
pub(crate) mod team_capabilities;

pub(crate) use cmd_capabilities::run_capabilities;
pub(crate) use cmd_config::run_config;
pub(crate) use cmd_diagnose::run_diagnose;
pub(crate) use cmd_doctor::run_doctor;
pub(crate) use cmd_prepare_managed_resources::run_prepare_managed_resources;
pub(crate) use cmd_server::{bind_http_listener, run_server};
pub(crate) use cmd_team::run_team;
pub(crate) use error::{CliBoundaryCode, CliBoundaryError};
pub(crate) use mcp::{run_app_tools_bridge, run_mcp_bridge, run_team_stdio};
