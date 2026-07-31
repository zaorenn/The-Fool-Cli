use sqlx::SqlitePool;

use crate::error::DbError;
use crate::models::{KanbanCardRow, KanbanColumnRow};
use crate::repository::kanban::{IKanbanRepository, KanbanCardPatch};

/// SQLite-backed implementation of [`IKanbanRepository`].
#[derive(Clone, Debug)]
pub struct SqliteKanbanRepository {
    pool: SqlitePool,
}

impl SqliteKanbanRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait::async_trait]
impl IKanbanRepository for SqliteKanbanRepository {
    async fn list_columns(&self, user_id: &str, project_id: &str) -> Result<Vec<KanbanColumnRow>, DbError> {
        let rows = sqlx::query_as::<_, KanbanColumnRow>(
            "SELECT column_id, project_id, user_id, name, order_index, created_at, updated_at \
             FROM kanban_columns WHERE user_id = ? AND project_id = ? ORDER BY order_index",
        )
        .bind(user_id)
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn create_column(&self, row: &KanbanColumnRow) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO kanban_columns (column_id, project_id, user_id, name, order_index, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&row.column_id)
        .bind(&row.project_id)
        .bind(&row.user_id)
        .bind(&row.name)
        .bind(row.order_index)
        .bind(row.created_at)
        .bind(row.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn get_column(&self, user_id: &str, column_id: &str) -> Result<Option<KanbanColumnRow>, DbError> {
        let row = sqlx::query_as::<_, KanbanColumnRow>(
            "SELECT column_id, project_id, user_id, name, order_index, created_at, updated_at \
             FROM kanban_columns WHERE user_id = ? AND column_id = ?",
        )
        .bind(user_id)
        .bind(column_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn delete_column(&self, user_id: &str, column_id: &str) -> Result<(), DbError> {
        sqlx::query("DELETE FROM kanban_columns WHERE user_id = ? AND column_id = ?")
            .bind(user_id)
            .bind(column_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_cards(&self, user_id: &str, project_id: &str) -> Result<Vec<KanbanCardRow>, DbError> {
        let rows = sqlx::query_as::<_, KanbanCardRow>(
            "SELECT card_id, project_id, user_id, column_id, title, body, assignee, due_at, \
                    conversation_id, order_index, created_at, updated_at \
             FROM kanban_cards WHERE user_id = ? AND project_id = ? ORDER BY column_id, order_index",
        )
        .bind(user_id)
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn get_card(&self, user_id: &str, card_id: &str) -> Result<Option<KanbanCardRow>, DbError> {
        let row = sqlx::query_as::<_, KanbanCardRow>(
            "SELECT card_id, project_id, user_id, column_id, title, body, assignee, due_at, \
                    conversation_id, order_index, created_at, updated_at \
             FROM kanban_cards WHERE user_id = ? AND card_id = ?",
        )
        .bind(user_id)
        .bind(card_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn create_card(&self, row: &KanbanCardRow) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO kanban_cards \
             (card_id, project_id, user_id, column_id, title, body, assignee, due_at, \
              conversation_id, order_index, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&row.card_id)
        .bind(&row.project_id)
        .bind(&row.user_id)
        .bind(&row.column_id)
        .bind(&row.title)
        .bind(&row.body)
        .bind(&row.assignee)
        .bind(row.due_at)
        .bind(&row.conversation_id)
        .bind(row.order_index)
        .bind(row.created_at)
        .bind(row.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn update_card(
        &self,
        user_id: &str,
        card_id: &str,
        patch: &KanbanCardPatch,
    ) -> Result<Option<KanbanCardRow>, DbError> {
        let Some(current) = self.get_card(user_id, card_id).await? else {
            return Ok(None);
        };

        let title = patch.title.clone().unwrap_or(current.title);
        let body = patch.body.clone().unwrap_or(current.body);
        let assignee = patch.assignee.clone().unwrap_or(current.assignee);
        let due_at = patch.due_at.unwrap_or(current.due_at);
        let conversation_id = patch.conversation_id.clone().unwrap_or(current.conversation_id);
        let column_id = patch.column_id.clone().unwrap_or(current.column_id);
        let order_index = patch.order_index.unwrap_or(current.order_index);
        let updated_at = fool_common::now_ms();

        sqlx::query(
            "UPDATE kanban_cards SET title = ?, body = ?, assignee = ?, due_at = ?, conversation_id = ?, \
             column_id = ?, order_index = ?, updated_at = ? WHERE user_id = ? AND card_id = ?",
        )
        .bind(&title)
        .bind(&body)
        .bind(&assignee)
        .bind(due_at)
        .bind(&conversation_id)
        .bind(&column_id)
        .bind(order_index)
        .bind(updated_at)
        .bind(user_id)
        .bind(card_id)
        .execute(&self.pool)
        .await?;

        self.get_card(user_id, card_id).await
    }

    async fn delete_card(&self, user_id: &str, card_id: &str) -> Result<(), DbError> {
        sqlx::query("DELETE FROM kanban_cards WHERE user_id = ? AND card_id = ?")
            .bind(user_id)
            .bind(card_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn count_cards_in_column(&self, user_id: &str, column_id: &str) -> Result<i64, DbError> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM kanban_cards WHERE user_id = ? AND column_id = ?")
            .bind(user_id)
            .bind(column_id)
            .fetch_one(&self.pool)
            .await?;
        Ok(count)
    }

    async fn max_order_index(&self, user_id: &str, column_id: &str) -> Result<Option<i64>, DbError> {
        let max: Option<i64> =
            sqlx::query_scalar("SELECT MAX(order_index) FROM kanban_cards WHERE user_id = ? AND column_id = ?")
                .bind(user_id)
                .bind(column_id)
                .fetch_one(&self.pool)
                .await?;
        Ok(max)
    }

    async fn renumber_column(&self, user_id: &str, column_id: &str) -> Result<(), DbError> {
        const STEP: i64 = 1024;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT card_id FROM kanban_cards WHERE user_id = ? AND column_id = ? ORDER BY order_index, card_id",
        )
        .bind(user_id)
        .bind(column_id)
        .fetch_all(&self.pool)
        .await?;

        let mut tx = self.pool.begin().await?;
        for (position, card_id) in ids.iter().enumerate() {
            let order_index = (position as i64 + 1) * STEP;
            sqlx::query("UPDATE kanban_cards SET order_index = ? WHERE user_id = ? AND card_id = ?")
                .bind(order_index)
                .bind(user_id)
                .bind(card_id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_database_memory;
    use fool_common::now_ms;

    const USER_A: &str = "system_default_user";
    const USER_B: &str = "user_b";
    const PROJECT: &str = "project-1";

    async fn setup() -> (SqliteKanbanRepository, crate::Database) {
        let db = init_database_memory().await.unwrap();
        sqlx::query(
            "INSERT INTO users (id, user_type, username, password_hash, status, session_generation, created_at, updated_at) \
             VALUES (?, 'local', ?, 'hash', 'active', 0, 1, 1)",
        )
        .bind(USER_B)
        .bind(USER_B)
        .execute(db.pool())
        .await
        .unwrap();
        (SqliteKanbanRepository::new(db.pool().clone()), db)
    }

    fn column(user_id: &str, column_id: &str, name: &str, order_index: i64) -> KanbanColumnRow {
        let now = now_ms();
        KanbanColumnRow {
            column_id: column_id.to_owned(),
            project_id: PROJECT.to_owned(),
            user_id: user_id.to_owned(),
            name: name.to_owned(),
            order_index,
            created_at: now,
            updated_at: now,
        }
    }

    fn card(user_id: &str, card_id: &str, column_id: &str, order_index: i64) -> KanbanCardRow {
        let now = now_ms();
        KanbanCardRow {
            card_id: card_id.to_owned(),
            project_id: PROJECT.to_owned(),
            user_id: user_id.to_owned(),
            column_id: column_id.to_owned(),
            title: "Card".to_owned(),
            body: String::new(),
            assignee: None,
            due_at: None,
            conversation_id: None,
            order_index,
            created_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn columns_are_listed_in_order() {
        let (repo, _db) = setup().await;
        repo.create_column(&column(USER_A, "col-2", "Doing", 2048))
            .await
            .unwrap();
        repo.create_column(&column(USER_A, "col-1", "To do", 1024))
            .await
            .unwrap();

        let columns = repo.list_columns(USER_A, PROJECT).await.unwrap();
        assert_eq!(
            columns.iter().map(|c| c.column_id.as_str()).collect::<Vec<_>>(),
            vec!["col-1", "col-2"]
        );
    }

    #[tokio::test]
    async fn a_card_updates_only_the_fields_the_patch_names() {
        let (repo, _db) = setup().await;
        repo.create_column(&column(USER_A, "col-1", "To do", 1024))
            .await
            .unwrap();
        repo.create_card(&card(USER_A, "card-1", "col-1", 1024)).await.unwrap();

        let updated = repo
            .update_card(
                USER_A,
                "card-1",
                &KanbanCardPatch {
                    title: Some("Renamed".to_owned()),
                    ..Default::default()
                },
            )
            .await
            .unwrap()
            .unwrap();

        assert_eq!(updated.title, "Renamed");
        assert_eq!(updated.column_id, "col-1"); // untouched
    }

    #[tokio::test]
    async fn clearing_a_conversation_link_sets_it_to_null_rather_than_leaving_it() {
        let (repo, _db) = setup().await;
        repo.create_column(&column(USER_A, "col-1", "To do", 1024))
            .await
            .unwrap();
        let mut seeded = card(USER_A, "card-1", "col-1", 1024);
        seeded.conversation_id = Some("conv-1".to_owned());
        repo.create_card(&seeded).await.unwrap();

        let updated = repo
            .update_card(
                USER_A,
                "card-1",
                &KanbanCardPatch {
                    conversation_id: Some(None),
                    ..Default::default()
                },
            )
            .await
            .unwrap()
            .unwrap();

        assert_eq!(updated.conversation_id, None);
    }

    #[tokio::test]
    async fn updating_a_card_nobody_owns_returns_none() {
        let (repo, _db) = setup().await;
        repo.create_column(&column(USER_A, "col-1", "To do", 1024))
            .await
            .unwrap();
        repo.create_card(&card(USER_A, "card-1", "col-1", 1024)).await.unwrap();

        let result = repo
            .update_card(USER_B, "card-1", &KanbanCardPatch::default())
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn deleting_a_card_is_scoped_to_its_owner() {
        let (repo, _db) = setup().await;
        repo.create_column(&column(USER_A, "col-1", "To do", 1024))
            .await
            .unwrap();
        repo.create_card(&card(USER_A, "card-1", "col-1", 1024)).await.unwrap();

        repo.delete_card(USER_B, "card-1").await.unwrap();
        assert!(repo.get_card(USER_A, "card-1").await.unwrap().is_some());

        repo.delete_card(USER_A, "card-1").await.unwrap();
        assert!(repo.get_card(USER_A, "card-1").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn count_cards_in_column_reflects_only_that_column() {
        let (repo, _db) = setup().await;
        repo.create_column(&column(USER_A, "col-1", "To do", 1024))
            .await
            .unwrap();
        repo.create_column(&column(USER_A, "col-2", "Doing", 2048))
            .await
            .unwrap();
        repo.create_card(&card(USER_A, "card-1", "col-1", 1024)).await.unwrap();
        repo.create_card(&card(USER_A, "card-2", "col-1", 2048)).await.unwrap();

        assert_eq!(repo.count_cards_in_column(USER_A, "col-1").await.unwrap(), 2);
        assert_eq!(repo.count_cards_in_column(USER_A, "col-2").await.unwrap(), 0);
    }

    #[tokio::test]
    async fn max_order_index_is_none_for_an_empty_column() {
        let (repo, _db) = setup().await;
        repo.create_column(&column(USER_A, "col-1", "To do", 1024))
            .await
            .unwrap();
        assert_eq!(repo.max_order_index(USER_A, "col-1").await.unwrap(), None);
    }

    #[tokio::test]
    async fn renumber_spreads_cards_back_out_over_the_step_in_their_existing_order() {
        let (repo, _db) = setup().await;
        repo.create_column(&column(USER_A, "col-1", "To do", 1024))
            .await
            .unwrap();
        // Two cards jammed together with nothing left to insert between them.
        repo.create_card(&card(USER_A, "card-1", "col-1", 100)).await.unwrap();
        repo.create_card(&card(USER_A, "card-2", "col-1", 101)).await.unwrap();

        repo.renumber_column(USER_A, "col-1").await.unwrap();

        let cards = repo.list_cards(USER_A, PROJECT).await.unwrap();
        assert_eq!(cards[0].card_id, "card-1");
        assert_eq!(cards[0].order_index, 1024);
        assert_eq!(cards[1].card_id, "card-2");
        assert_eq!(cards[1].order_index, 2048);
    }

    #[tokio::test]
    async fn boards_are_isolated_by_user() {
        let (repo, _db) = setup().await;
        repo.create_column(&column(USER_A, "col-a", "To do", 1024))
            .await
            .unwrap();
        repo.create_column(&column(USER_B, "col-b", "To do", 1024))
            .await
            .unwrap();

        let a_columns = repo.list_columns(USER_A, PROJECT).await.unwrap();
        assert_eq!(a_columns.len(), 1);
        assert_eq!(a_columns[0].column_id, "col-a");

        assert!(repo.get_column(USER_A, "col-b").await.unwrap().is_none());
    }
}
