use std::sync::Arc;

use async_trait::async_trait;
use fool_api_types::{APP_TOOL_REQUEST_EVENT, AppToolRequest, WebSocketMessage};
use fool_mcp_server::{HostResolver, McpToolHost, ToolDescriptor};
use fool_realtime::EventBroadcaster;
use serde_json::Value;

use crate::catalogue::{Catalogue, CataloguePart};
use crate::pending::PendingCalls;

/// What a model is told when the application does not answer.
///
/// Written as a sentence it can repeat, and written as a failure rather than as
/// an absence: a tool that returns nothing is read by a model as a tool that
/// worked, and that is exactly the lie this application has spent releases
/// making impossible.
const NO_ANSWER: &str = "The application did not answer in time; the action was not carried out.";

/// What a model is told when it asks for a tool the application does not have.
const NOT_OFFERED: &str = "This application has no such tool; the action was not carried out.";

/// An MCP host that performs no work itself.
///
/// Bound to one conversation, because a permission decision belongs to a
/// conversation rather than to the application as a whole — and because the
/// renderer has to know which conversation a call is for before it can show
/// anything about it.
pub struct AppToolHost {
    catalogue: Arc<Catalogue>,
    /// Which half of the catalogue this host advertises.
    ///
    /// Both halves *run* every tool: the split is about what is described in
    /// the prompt, not about what is permitted. A model that reaches the
    /// deferred half through `ToolSearch` must not then be told the tool does
    /// not exist.
    part: CataloguePart,
    pending: Arc<PendingCalls>,
    broadcaster: Arc<dyn EventBroadcaster>,
    conversation_id: String,
}

impl AppToolHost {
    pub fn new(
        catalogue: Arc<Catalogue>,
        pending: Arc<PendingCalls>,
        broadcaster: Arc<dyn EventBroadcaster>,
        conversation_id: String,
    ) -> Self {
        Self::for_part(catalogue, pending, broadcaster, conversation_id, CataloguePart::Core)
    }

    pub fn for_part(
        catalogue: Arc<Catalogue>,
        pending: Arc<PendingCalls>,
        broadcaster: Arc<dyn EventBroadcaster>,
        conversation_id: String,
        part: CataloguePart,
    ) -> Self {
        Self {
            catalogue,
            pending,
            broadcaster,
            conversation_id,
            part,
        }
    }
}

#[async_trait]
impl McpToolHost for AppToolHost {
    async fn list_tools(&self) -> Vec<ToolDescriptor> {
        self.catalogue.tools_in(self.part)
    }

    async fn call_tool(&self, name: &str, arguments: Value) -> Result<String, String> {
        if !self.catalogue.offers(name) {
            return Err(NOT_OFFERED.to_string());
        }

        let call_id = uuid::Uuid::now_v7().to_string();
        let request = AppToolRequest {
            conversation_id: self.conversation_id.clone(),
            call_id: call_id.clone(),
            name: name.to_string(),
            arguments,
        };
        let payload = serde_json::to_value(&request).map_err(|error| error.to_string())?;

        // Broadcast first, then wait. The registration happens inside `issue`
        // before it yields, so a renderer that answers instantly cannot answer
        // into an empty room.
        self.broadcaster
            .broadcast(WebSocketMessage::new(APP_TOOL_REQUEST_EVENT, payload));

        match self.pending.issue(call_id).await {
            Ok(result) if result.ok => Ok(result.content),
            Ok(result) => Err(result.content),
            Err(_) => Err(NO_ANSWER.to_string()),
        }
    }
}

/// Hands out a host bound to whichever conversation the call arrived for.
///
/// One instance for the whole application; the conversation id is the last path
/// segment, which is what the session's MCP URL was built with. The alternative
/// was a TCP listener per conversation.
pub struct AppToolHosts {
    catalogue: Arc<Catalogue>,
    pending: Arc<PendingCalls>,
    broadcaster: Arc<dyn EventBroadcaster>,
}

impl AppToolHosts {
    pub fn new(catalogue: Arc<Catalogue>, pending: Arc<PendingCalls>, broadcaster: Arc<dyn EventBroadcaster>) -> Self {
        Self {
            catalogue,
            pending,
            broadcaster,
        }
    }
}

impl HostResolver for AppToolHosts {
    fn resolve(&self, path: &str) -> Option<Arc<dyn McpToolHost>> {
        let rest = path.strip_prefix("/mcp/")?.trim_end_matches('/');
        // `/mcp/rest/<conversation>` is the deferred half; anything else is the
        // core one, so an older client that knows only `/mcp/<conversation>`
        // keeps working and simply sees every tool.
        let (part, conversation_id) = match rest.strip_prefix("rest/") {
            Some(id) => (CataloguePart::Rest, id),
            None => (CataloguePart::Core, rest),
        };
        if conversation_id.is_empty() {
            return None;
        }
        Some(Arc::new(AppToolHost::for_part(
            self.catalogue.clone(),
            self.pending.clone(),
            self.broadcaster.clone(),
            conversation_id.to_owned(),
            part,
        )))
    }
}

#[cfg(test)]
#[path = "host_test.rs"]
mod host_test;
