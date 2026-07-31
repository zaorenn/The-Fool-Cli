//! Project Kanban board wire DTOs.
//!
//! `GET /api/projects/{project_id}/kanban` returns the whole board in one
//! call — columns in display order, each carrying its own cards — so the
//! frontend never fans out one request per column.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KanbanBoardResponse {
    pub columns: Vec<KanbanColumnResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KanbanColumnResponse {
    pub column_id: String,
    pub name: String,
    pub order_index: i64,
    pub cards: Vec<KanbanCardResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KanbanCardResponse {
    pub card_id: String,
    pub column_id: String,
    pub title: String,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    pub order_index: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateKanbanColumnRequest {
    pub name: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct UpdateKanbanColumnRequest {
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateKanbanCardRequest {
    pub column_id: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
}

/// Every field optional so a `PATCH` can move a card, rename it, or both in
/// one call. `Option<Option<T>>` fields distinguish "not sent" from "sent as
/// null" — the latter clears the field (e.g. unlinking a conversation).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct UpdateKanbanCardRequest {
    pub title: Option<String>,
    pub body: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub assignee: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub due_at: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub conversation_id: Option<Option<String>>,
    /// Moving the card: the destination column, and the card it should land
    /// just after within that column. `after_card_id: null`/absent moves it
    /// to the front of `column_id`.
    pub column_id: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub after_card_id: Option<Option<String>>,
}

/// Deserializes a JSON field into `Option<Option<T>>`: the outer `Option`
/// tracks whether the key was present at all (via `#[serde(default)]` on the
/// field), the inner tracks `null` vs a real value. Without this, serde's
/// default `Option<T>` collapses "absent" and "sent as null" into the same
/// `None`, and a card's assignee or conversation link could never be cleared
/// through the same request shape that sets it.
fn double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::deserialize(deserializer)?))
}
