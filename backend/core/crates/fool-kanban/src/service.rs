use std::sync::Arc;

use fool_api_types::{
    CreateKanbanCardRequest, CreateKanbanColumnRequest, KanbanBoardResponse, KanbanCardResponse, KanbanColumnResponse,
    UpdateKanbanCardRequest, UpdateKanbanColumnRequest, WebSocketMessage,
};
use fool_common::{generate_id, now_ms};
use fool_db::{IKanbanRepository, KanbanCardPatch, KanbanCardRow, KanbanColumnRow};
use fool_realtime::EventBroadcaster;

use crate::error::KanbanError;

/// Cards allocate order positions in steps of this size, so a card dropped
/// between two neighbours takes the midpoint and writes one row instead of
/// renumbering the column. Also used for columns, which have far fewer rows
/// but no reason to use a different scheme.
const ORDER_STEP: i64 = 1024;

/// Broadcast after any successful write — see `settings.clientPreferencesChanged`
/// for the shape this follows: names and scope only, never card content. The
/// bus reaches every connection while a board belongs to one user, so a
/// payload carrying titles would hand one user's work to another; a client
/// re-reads the board through its own authenticated request, which can only
/// ever return its own board.
pub const KANBAN_BOARD_CHANGED_EVENT: &str = "kanban.boardChanged";

const DEFAULT_COLUMN_NAMES: [&str; 3] = ["To do", "Doing", "Done"];

pub struct KanbanService {
    repo: Arc<dyn IKanbanRepository>,
    broadcaster: Option<Arc<dyn EventBroadcaster>>,
}

impl KanbanService {
    pub fn new(repo: Arc<dyn IKanbanRepository>) -> Self {
        Self {
            repo,
            broadcaster: None,
        }
    }

    pub fn with_broadcaster(mut self, broadcaster: Arc<dyn EventBroadcaster>) -> Self {
        self.broadcaster = Some(broadcaster);
        self
    }

    /// The whole board, creating the default columns on first read.
    ///
    /// Lazy rather than at project creation: most projects never open their
    /// board at all, and a project created before Kanban existed must get one
    /// too the first time it is opened.
    pub async fn get_board(&self, user_id: &str, project_id: &str) -> Result<KanbanBoardResponse, KanbanError> {
        let mut columns = self.repo.list_columns(user_id, project_id).await?;
        if columns.is_empty() {
            for (index, name) in DEFAULT_COLUMN_NAMES.iter().enumerate() {
                let row = new_column_row(user_id, project_id, name, ((index as i64) + 1) * ORDER_STEP);
                self.repo.create_column(&row).await?;
                columns.push(row);
            }
        }

        let cards = self.repo.list_cards(user_id, project_id).await?;
        Ok(KanbanBoardResponse {
            columns: columns
                .into_iter()
                .map(|column| {
                    let column_cards = cards
                        .iter()
                        .filter(|card| card.column_id == column.column_id)
                        .cloned()
                        .map(card_response)
                        .collect();
                    column_response(column, column_cards)
                })
                .collect(),
        })
    }

    pub async fn create_column(
        &self,
        user_id: &str,
        project_id: &str,
        request: CreateKanbanColumnRequest,
    ) -> Result<KanbanColumnResponse, KanbanError> {
        let existing = self.repo.list_columns(user_id, project_id).await?;
        let order_index = existing.iter().map(|c| c.order_index).max().unwrap_or(0) + ORDER_STEP;
        let row = new_column_row(user_id, project_id, &request.name, order_index);
        self.repo.create_column(&row).await?;
        self.announce(user_id, "column");
        Ok(column_response(row, vec![]))
    }

    pub async fn update_column(
        &self,
        user_id: &str,
        column_id: &str,
        request: UpdateKanbanColumnRequest,
    ) -> Result<KanbanColumnResponse, KanbanError> {
        let existing = self
            .repo
            .get_column(user_id, column_id)
            .await?
            .ok_or_else(|| KanbanError::NotFound(format!("column {column_id}")))?;
        let name = request.name.unwrap_or(existing.name);
        let row = KanbanColumnRow {
            name,
            updated_at: now_ms(),
            ..existing
        };
        // No dedicated update method: a column is one row with almost nothing
        // on it, so recreating it via delete+insert would cost a migration's
        // worth of ceremony for a rename. Delete-then-create is safe here
        // specifically because cards reference `column_id`, not the row's
        // surrogate key, and this keeps `column_id` unchanged.
        self.repo.delete_column(user_id, column_id).await?;
        self.repo.create_column(&row).await?;
        self.announce(user_id, "column");
        let cards = self.repo.list_cards(user_id, &row.project_id).await?;
        let column_cards = cards
            .into_iter()
            .filter(|c| c.column_id == row.column_id)
            .map(card_response)
            .collect();
        Ok(column_response(row, column_cards))
    }

    pub async fn delete_column(&self, user_id: &str, column_id: &str) -> Result<(), KanbanError> {
        if self.repo.count_cards_in_column(user_id, column_id).await? > 0 {
            return Err(KanbanError::ColumnNotEmpty);
        }
        self.repo.delete_column(user_id, column_id).await?;
        self.announce(user_id, "column");
        Ok(())
    }

    pub async fn create_card(
        &self,
        user_id: &str,
        project_id: &str,
        request: CreateKanbanCardRequest,
    ) -> Result<KanbanCardResponse, KanbanError> {
        self.repo
            .get_column(user_id, &request.column_id)
            .await?
            .ok_or_else(|| KanbanError::NotFound(format!("column {}", request.column_id)))?;

        let order_index = self
            .repo
            .max_order_index(user_id, &request.column_id)
            .await?
            .unwrap_or(0)
            + ORDER_STEP;
        let now = now_ms();
        let row = KanbanCardRow {
            card_id: generate_id(),
            project_id: project_id.to_owned(),
            user_id: user_id.to_owned(),
            column_id: request.column_id,
            title: request.title,
            body: request.body,
            assignee: None,
            due_at: None,
            conversation_id: None,
            order_index,
            created_at: now,
            updated_at: now,
        };
        self.repo.create_card(&row).await?;
        self.announce(user_id, "card");
        Ok(card_response(row))
    }

    pub async fn update_card(
        &self,
        user_id: &str,
        card_id: &str,
        request: UpdateKanbanCardRequest,
    ) -> Result<KanbanCardResponse, KanbanError> {
        let current = self
            .repo
            .get_card(user_id, card_id)
            .await?
            .ok_or_else(|| KanbanError::NotFound(format!("card {card_id}")))?;

        let target_column = request.column_id.clone().unwrap_or_else(|| current.column_id.clone());
        if request.column_id.is_some() {
            self.repo
                .get_column(user_id, &target_column)
                .await?
                .ok_or_else(|| KanbanError::NotFound(format!("column {target_column}")))?;
        }

        // Only recompute a position when the card is actually moving — either
        // to a different column, or explicitly placed after a named
        // neighbour. Editing a card's title must not silently reshuffle it.
        let order_index = if request.column_id.is_some() || request.after_card_id.is_some() {
            Some(
                self.resolve_order_index(
                    user_id,
                    &target_column,
                    request.after_card_id.clone().flatten().as_deref(),
                )
                .await?,
            )
        } else {
            None
        };

        let patch = KanbanCardPatch {
            title: request.title,
            body: request.body,
            assignee: request.assignee,
            due_at: request.due_at,
            conversation_id: request.conversation_id,
            column_id: request.column_id,
            order_index,
        };
        let updated = self
            .repo
            .update_card(user_id, card_id, &patch)
            .await?
            .ok_or_else(|| KanbanError::NotFound(format!("card {card_id}")))?;
        self.announce(user_id, "card");
        Ok(card_response(updated))
    }

    pub async fn delete_card(&self, user_id: &str, card_id: &str) -> Result<(), KanbanError> {
        self.repo.delete_card(user_id, card_id).await?;
        self.announce(user_id, "card");
        Ok(())
    }

    /// Where a card dropped after `after_card_id` (or at the front, if none)
    /// lands, as a sparse `order_index`. Renumbers the column and retries
    /// once if the neighbours it lands between have no integer left.
    async fn resolve_order_index(
        &self,
        user_id: &str,
        column_id: &str,
        after_card_id: Option<&str>,
    ) -> Result<i64, KanbanError> {
        for attempt in 0..2 {
            let mut in_column: Vec<KanbanCardRow> = self
                .repo
                .list_cards(user_id, &self.column_project_id(user_id, column_id).await?)
                .await?
                .into_iter()
                .filter(|card| card.column_id == column_id)
                .collect();
            in_column.sort_by_key(|card| card.order_index);

            match compute_slot(&in_column, after_card_id) {
                Ok(index) => return Ok(index),
                Err(NeedsRenumber) if attempt == 0 => {
                    self.repo.renumber_column(user_id, column_id).await?;
                }
                Err(NeedsRenumber) => {
                    return Err(KanbanError::Internal(
                        "could not find room for card after renumbering".into(),
                    ));
                }
            }
        }
        unreachable!("loop returns or errors on both iterations")
    }

    async fn column_project_id(&self, user_id: &str, column_id: &str) -> Result<String, KanbanError> {
        Ok(self
            .repo
            .get_column(user_id, column_id)
            .await?
            .ok_or_else(|| KanbanError::NotFound(format!("column {column_id}")))?
            .project_id)
    }

    fn announce(&self, user_id: &str, change: &'static str) {
        let Some(broadcaster) = &self.broadcaster else { return };
        broadcaster.broadcast(WebSocketMessage::new(
            KANBAN_BOARD_CHANGED_EVENT,
            serde_json::json!({ "user_id": user_id, "change": change }),
        ));
    }
}

struct NeedsRenumber;

/// Pure placement math, kept separate from any repository call so it can be
/// tested without a database.
fn compute_slot(sorted_column: &[KanbanCardRow], after_card_id: Option<&str>) -> Result<i64, NeedsRenumber> {
    match after_card_id {
        None => match sorted_column.first() {
            None => Ok(ORDER_STEP),
            Some(first) => {
                let candidate = first.order_index / 2;
                if candidate < first.order_index {
                    Ok(candidate)
                } else {
                    Err(NeedsRenumber)
                }
            }
        },
        Some(after_id) => {
            let position = sorted_column
                .iter()
                .position(|card| card.card_id == after_id)
                .ok_or(NeedsRenumber)?;
            let anchor = sorted_column[position].order_index;
            match sorted_column.get(position + 1) {
                None => Ok(anchor + ORDER_STEP),
                Some(next) if next.order_index - anchor >= 2 => Ok(anchor + (next.order_index - anchor) / 2),
                Some(_) => Err(NeedsRenumber),
            }
        }
    }
}

fn new_column_row(user_id: &str, project_id: &str, name: &str, order_index: i64) -> KanbanColumnRow {
    let now = now_ms();
    KanbanColumnRow {
        column_id: generate_id(),
        project_id: project_id.to_owned(),
        user_id: user_id.to_owned(),
        name: name.to_owned(),
        order_index,
        created_at: now,
        updated_at: now,
    }
}

fn column_response(column: KanbanColumnRow, cards: Vec<KanbanCardResponse>) -> KanbanColumnResponse {
    KanbanColumnResponse {
        column_id: column.column_id,
        name: column.name,
        order_index: column.order_index,
        cards,
    }
}

fn card_response(card: KanbanCardRow) -> KanbanCardResponse {
    KanbanCardResponse {
        card_id: card.card_id,
        column_id: card.column_id,
        title: card.title,
        body: card.body,
        assignee: card.assignee,
        due_at: card.due_at,
        conversation_id: card.conversation_id,
        order_index: card.order_index,
        created_at: card.created_at,
        updated_at: card.updated_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fool_db::{SqliteKanbanRepository, init_database_memory};

    const USER: &str = "system_default_user";
    const PROJECT: &str = "project-1";

    async fn service() -> KanbanService {
        let db = init_database_memory().await.unwrap();
        let repo = Arc::new(SqliteKanbanRepository::new(db.pool().clone()));
        std::mem::forget(db);
        KanbanService::new(repo)
    }

    #[derive(Default)]
    struct RecordingBroadcaster {
        events: std::sync::Mutex<Vec<fool_api_types::WebSocketMessage<serde_json::Value>>>,
    }

    impl EventBroadcaster for RecordingBroadcaster {
        fn broadcast(&self, event: fool_api_types::WebSocketMessage<serde_json::Value>) {
            self.events.lock().unwrap().push(event);
        }
    }

    #[tokio::test]
    async fn a_write_announces_the_change_but_carries_no_card_content() {
        let db = init_database_memory().await.unwrap();
        let repo = Arc::new(SqliteKanbanRepository::new(db.pool().clone()));
        std::mem::forget(db);
        let broadcaster = Arc::new(RecordingBroadcaster::default());
        let svc = KanbanService::new(repo).with_broadcaster(broadcaster.clone());

        let board = svc.get_board(USER, PROJECT).await.unwrap();
        let todo = board.columns[0].column_id.clone();
        svc.create_card(
            USER,
            PROJECT,
            CreateKanbanCardRequest {
                column_id: todo,
                title: "Secret plan".into(),
                body: "don't leak me".into(),
            },
        )
        .await
        .unwrap();

        let events = broadcaster.events.lock().unwrap();
        let last = events.last().expect("a write should announce");
        assert_eq!(last.name, KANBAN_BOARD_CHANGED_EVENT);
        assert_eq!(last.data["user_id"], serde_json::json!(USER));
        assert_eq!(last.data["change"], serde_json::json!("card"));
        // The bus reaches every connection while a board belongs to one user;
        // a payload carrying titles would hand one user's work to another.
        let payload = serde_json::to_string(&*last).unwrap();
        assert!(!payload.contains("Secret plan"), "{payload}");
        assert!(!payload.contains("leak"), "{payload}");
    }

    #[tokio::test]
    async fn get_board_creates_the_default_columns_once() {
        let svc = service().await;

        let board = svc.get_board(USER, PROJECT).await.unwrap();
        assert_eq!(
            board.columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            vec!["To do", "Doing", "Done"]
        );

        // A second read must not create a second set.
        let board_again = svc.get_board(USER, PROJECT).await.unwrap();
        assert_eq!(board_again.columns.len(), 3);
    }

    #[tokio::test]
    async fn a_new_card_lands_at_the_end_of_its_column() {
        let svc = service().await;
        let board = svc.get_board(USER, PROJECT).await.unwrap();
        let todo = &board.columns[0];

        let card1 = svc
            .create_card(
                USER,
                PROJECT,
                CreateKanbanCardRequest {
                    column_id: todo.column_id.clone(),
                    title: "First".into(),
                    body: "".into(),
                },
            )
            .await
            .unwrap();
        let card2 = svc
            .create_card(
                USER,
                PROJECT,
                CreateKanbanCardRequest {
                    column_id: todo.column_id.clone(),
                    title: "Second".into(),
                    body: "".into(),
                },
            )
            .await
            .unwrap();

        assert!(card2.order_index > card1.order_index);
    }

    #[tokio::test]
    async fn moving_a_card_between_two_neighbours_lands_it_between_them() {
        let svc = service().await;
        let board = svc.get_board(USER, PROJECT).await.unwrap();
        let todo = board.columns[0].column_id.clone();

        let a = svc
            .create_card(
                USER,
                PROJECT,
                CreateKanbanCardRequest {
                    column_id: todo.clone(),
                    title: "A".into(),
                    body: "".into(),
                },
            )
            .await
            .unwrap();
        let b = svc
            .create_card(
                USER,
                PROJECT,
                CreateKanbanCardRequest {
                    column_id: todo.clone(),
                    title: "B".into(),
                    body: "".into(),
                },
            )
            .await
            .unwrap();
        let c = svc
            .create_card(
                USER,
                PROJECT,
                CreateKanbanCardRequest {
                    column_id: todo.clone(),
                    title: "C".into(),
                    body: "".into(),
                },
            )
            .await
            .unwrap();

        // Move C to between A and B.
        let moved = svc
            .update_card(
                USER,
                &c.card_id,
                UpdateKanbanCardRequest {
                    after_card_id: Some(Some(a.card_id.clone())),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        assert!(moved.order_index > a.order_index);
        assert!(moved.order_index < b.order_index);
    }

    #[tokio::test]
    async fn renumbers_and_still_finds_room_when_two_neighbours_have_nothing_between_them() {
        let svc = service().await;
        let board = svc.get_board(USER, PROJECT).await.unwrap();
        let todo = board.columns[0].column_id.clone();

        let a = svc
            .create_card(
                USER,
                PROJECT,
                CreateKanbanCardRequest {
                    column_id: todo.clone(),
                    title: "A".into(),
                    body: "".into(),
                },
            )
            .await
            .unwrap();
        let b = svc
            .create_card(
                USER,
                PROJECT,
                CreateKanbanCardRequest {
                    column_id: todo.clone(),
                    title: "B".into(),
                    body: "".into(),
                },
            )
            .await
            .unwrap();
        // Force them adjacent with no integer gap between them, so the next
        // insert-between has nothing to land on without a renumber first.
        let a_row = svc.repo.get_card(USER, &a.card_id).await.unwrap().unwrap();
        let patch = KanbanCardPatch {
            order_index: Some(a_row.order_index + 1),
            ..Default::default()
        };
        svc.repo.update_card(USER, &b.card_id, &patch).await.unwrap();

        let c = svc
            .create_card(
                USER,
                PROJECT,
                CreateKanbanCardRequest {
                    column_id: todo.clone(),
                    title: "C".into(),
                    body: "".into(),
                },
            )
            .await
            .unwrap();

        let moved = svc
            .update_card(
                USER,
                &c.card_id,
                UpdateKanbanCardRequest {
                    after_card_id: Some(Some(a.card_id.clone())),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        let refreshed_a = svc.repo.get_card(USER, &a.card_id).await.unwrap().unwrap();
        let refreshed_b = svc.repo.get_card(USER, &b.card_id).await.unwrap().unwrap();
        assert!(moved.order_index > refreshed_a.order_index);
        assert!(moved.order_index < refreshed_b.order_index);
    }

    #[tokio::test]
    async fn deleting_a_non_empty_column_is_refused() {
        let svc = service().await;
        let board = svc.get_board(USER, PROJECT).await.unwrap();
        let todo = board.columns[0].column_id.clone();
        svc.create_card(
            USER,
            PROJECT,
            CreateKanbanCardRequest {
                column_id: todo.clone(),
                title: "A".into(),
                body: "".into(),
            },
        )
        .await
        .unwrap();

        let result = svc.delete_column(USER, &todo).await;
        assert!(matches!(result, Err(KanbanError::ColumnNotEmpty)));
    }

    #[tokio::test]
    async fn deleting_an_empty_column_succeeds() {
        let svc = service().await;
        let board = svc.get_board(USER, PROJECT).await.unwrap();
        let done = board.columns[2].column_id.clone();

        svc.delete_column(USER, &done).await.unwrap();
        let board_after = svc.get_board(USER, PROJECT).await.unwrap();
        assert_eq!(board_after.columns.len(), 2);
    }

    #[tokio::test]
    async fn clearing_a_conversation_link_sets_it_to_null() {
        let svc = service().await;
        let board = svc.get_board(USER, PROJECT).await.unwrap();
        let todo = board.columns[0].column_id.clone();
        let card = svc
            .create_card(
                USER,
                PROJECT,
                CreateKanbanCardRequest {
                    column_id: todo,
                    title: "A".into(),
                    body: "".into(),
                },
            )
            .await
            .unwrap();
        svc.update_card(
            USER,
            &card.card_id,
            UpdateKanbanCardRequest {
                conversation_id: Some(Some("conv-1".into())),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let cleared = svc
            .update_card(
                USER,
                &card.card_id,
                UpdateKanbanCardRequest {
                    conversation_id: Some(None),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        assert_eq!(cleared.conversation_id, None);
    }
}
