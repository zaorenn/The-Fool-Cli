use std::sync::Arc;

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use fool_api_types::AppToolResult;
use fool_mcp_server::ToolDescriptor;
use serde::Deserialize;

use crate::catalogue::Catalogue;
use crate::pending::PendingCalls;

/// The two halves of the channel the renderer talks to.
#[derive(Clone)]
pub struct AppToolsState {
    pub catalogue: Arc<Catalogue>,
    pub pending: Arc<PendingCalls>,
}

#[derive(Deserialize)]
pub struct CatalogueBody {
    pub tools: Vec<ToolDescriptor>,
    /// The few that stay in the prompt. Absent means "no split yet", and
    /// everything is treated as core rather than as nothing.
    #[serde(default)]
    pub core: Vec<String>,
}

/// One path to say what the application can do, one to answer a call.
///
/// The same shape as the confirmation routes in `fool-conversation`: something
/// goes out over the websocket and comes back over HTTP.
pub fn router(state: AppToolsState) -> Router {
    Router::new()
        .route("/api/app-tools/catalogue", post(register_catalogue))
        .route("/api/app-tools/result", post(receive_result))
        .with_state(state)
}

async fn register_catalogue(State(state): State<AppToolsState>, Json(body): Json<CatalogueBody>) {
    state.catalogue.replace(body.tools);
    state.catalogue.set_core(body.core);
}

async fn receive_result(State(state): State<AppToolsState>, Json(result): Json<AppToolResult>) {
    // The return is deliberately ignored. A result whose call has already timed
    // out has nowhere to go, and there is nothing the renderer could do about
    // it — the agent was told the call failed a while ago.
    let _ = state.pending.resolve(result);
}

#[cfg(test)]
#[path = "routes_test.rs"]
mod routes_test;
