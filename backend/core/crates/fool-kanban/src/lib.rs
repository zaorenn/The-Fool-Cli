//! Project Kanban board: one board per project, columns and cards.
//!
//! See `docs/specs/2026-07-31-project-kanban-design.md` for the design this
//! implements a first vertical slice of.

mod error;
mod service;
mod state;

pub mod routes;

pub use error::KanbanError;
pub use routes::kanban_routes;
pub use service::KanbanService;
pub use state::KanbanRouterState;
