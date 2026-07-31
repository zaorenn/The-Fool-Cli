use fool_common::TimestampMs;
use serde::{Deserialize, Serialize};

/// Row mapping for the `kanban_columns` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct KanbanColumnRow {
    pub column_id: String,
    pub project_id: String,
    pub user_id: String,
    pub name: String,
    pub order_index: i64,
    pub created_at: TimestampMs,
    pub updated_at: TimestampMs,
}

/// Row mapping for the `kanban_cards` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct KanbanCardRow {
    pub card_id: String,
    pub project_id: String,
    pub user_id: String,
    pub column_id: String,
    pub title: String,
    pub body: String,
    pub assignee: Option<String>,
    pub due_at: Option<TimestampMs>,
    pub conversation_id: Option<String>,
    pub order_index: i64,
    pub created_at: TimestampMs,
    pub updated_at: TimestampMs,
}
