use std::fmt;

/// Crate-owned error; routes map this to `ApiError` at the HTTP boundary.
#[derive(Debug)]
pub enum KanbanError {
    NotFound(String),
    /// A column still holds cards — deleting it would orphan them.
    ColumnNotEmpty,
    Internal(String),
}

impl fmt::Display for KanbanError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            KanbanError::NotFound(what) => write!(f, "not found: {what}"),
            KanbanError::ColumnNotEmpty => write!(f, "column still has cards"),
            KanbanError::Internal(message) => write!(f, "internal error: {message}"),
        }
    }
}

impl std::error::Error for KanbanError {}

impl From<fool_db::DbError> for KanbanError {
    fn from(error: fool_db::DbError) -> Self {
        KanbanError::Internal(error.to_string())
    }
}
