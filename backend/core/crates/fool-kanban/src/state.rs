use std::sync::Arc;

use crate::service::KanbanService;

/// Router state for the Kanban routes — the sole handle handlers hold.
#[derive(Clone)]
pub struct KanbanRouterState {
    pub service: Arc<KanbanService>,
}
