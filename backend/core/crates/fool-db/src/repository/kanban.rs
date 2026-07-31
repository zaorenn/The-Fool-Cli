use crate::error::DbError;
use crate::models::{KanbanCardRow, KanbanColumnRow};

/// Fields a card update may change. `None` leaves the column untouched;
/// `Some(None)` on an `Option<T>` field clears it (e.g. unlinking a
/// conversation). Distinguishing "not sent" from "sent as null" is why every
/// field is doubly-optional rather than defaulted.
#[derive(Debug, Clone, Default)]
pub struct KanbanCardPatch {
    pub title: Option<String>,
    pub body: Option<String>,
    pub assignee: Option<Option<String>>,
    pub due_at: Option<Option<i64>>,
    pub conversation_id: Option<Option<String>>,
    pub column_id: Option<String>,
    pub order_index: Option<i64>,
}

/// Kanban board data access: one board per project, columns and cards scoped
/// to the owning user.
#[async_trait::async_trait]
pub trait IKanbanRepository: Send + Sync {
    async fn list_columns(&self, user_id: &str, project_id: &str) -> Result<Vec<KanbanColumnRow>, DbError>;
    async fn create_column(&self, row: &KanbanColumnRow) -> Result<(), DbError>;
    async fn get_column(&self, user_id: &str, column_id: &str) -> Result<Option<KanbanColumnRow>, DbError>;
    async fn delete_column(&self, user_id: &str, column_id: &str) -> Result<(), DbError>;

    async fn list_cards(&self, user_id: &str, project_id: &str) -> Result<Vec<KanbanCardRow>, DbError>;
    async fn get_card(&self, user_id: &str, card_id: &str) -> Result<Option<KanbanCardRow>, DbError>;
    async fn create_card(&self, row: &KanbanCardRow) -> Result<(), DbError>;
    async fn update_card(
        &self,
        user_id: &str,
        card_id: &str,
        patch: &KanbanCardPatch,
    ) -> Result<Option<KanbanCardRow>, DbError>;
    async fn delete_card(&self, user_id: &str, card_id: &str) -> Result<(), DbError>;

    /// Whether a column still holds cards — the service refuses to delete one
    /// that does, rather than orphaning the cards inside it.
    async fn count_cards_in_column(&self, user_id: &str, column_id: &str) -> Result<i64, DbError>;

    /// The highest `order_index` in a column, for appending a new card or
    /// column past the end.
    async fn max_order_index(&self, user_id: &str, column_id: &str) -> Result<Option<i64>, DbError>;

    /// Spreads a column's cards back out over the sparse step, in their
    /// current relative order. Called when two neighbours' midpoint has
    /// collided and there is no integer left to insert between them.
    async fn renumber_column(&self, user_id: &str, column_id: &str) -> Result<(), DbError>;
}
