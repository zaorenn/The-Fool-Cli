use async_trait::async_trait;
use fool_db::DbError;
use fool_db::models::ClientPreference;

use super::*;

/// Answers with whatever it was built with, or refuses outright.
struct FakeRepo {
    stored: Option<String>,
    fails: bool,
}

impl FakeRepo {
    fn holding(value: &str) -> Arc<dyn IClientPreferenceRepository> {
        Arc::new(Self {
            stored: Some(value.to_string()),
            fails: false,
        })
    }

    fn empty() -> Arc<dyn IClientPreferenceRepository> {
        Arc::new(Self {
            stored: None,
            fails: false,
        })
    }

    fn broken() -> Arc<dyn IClientPreferenceRepository> {
        Arc::new(Self {
            stored: None,
            fails: true,
        })
    }
}

#[async_trait]
impl IClientPreferenceRepository for FakeRepo {
    async fn get_all(&self, user_id: &str) -> Result<Vec<ClientPreference>, DbError> {
        self.get_by_keys(user_id, &[MEMORY_KEY]).await
    }

    async fn get_by_keys(&self, user_id: &str, _keys: &[&str]) -> Result<Vec<ClientPreference>, DbError> {
        if self.fails {
            return Err(DbError::NotFound("no database".into()));
        }
        Ok(self
            .stored
            .iter()
            .map(|value| ClientPreference {
                user_id: user_id.to_string(),
                key: MEMORY_KEY.to_string(),
                value: value.clone(),
                updated_at: 0,
            })
            .collect())
    }

    async fn upsert_batch(&self, _user_id: &str, _entries: &[(&str, &str)]) -> Result<(), DbError> {
        Ok(())
    }

    async fn delete_keys(&self, _user_id: &str, _keys: &[&str]) -> Result<(), DbError> {
        Ok(())
    }
}

#[tokio::test]
async fn what_was_said_out_loud_reaches_a_typed_conversation() {
    let repo = FakeRepo::holding(r##"{"user":"# About you\n\nCall me Ada.","agent":"","introduced":true}"##);

    let memory = read_shared_memory(Some(&repo), "me").await.expect("a memory");

    assert!(memory.contains("Call me Ada."), "{memory}");
    assert!(memory.starts_with("<user-memory>") && memory.ends_with("</user-memory>"));
}

#[tokio::test]
async fn both_documents_come_through() {
    let repo = FakeRepo::holding(r#"{"user":"Who I am.","agent":"How to work with me."}"#);

    let memory = read_shared_memory(Some(&repo), "me").await.expect("a memory");

    assert!(memory.contains("Who I am."));
    assert!(memory.contains("How to work with me."));
}

#[tokio::test]
async fn an_empty_memory_says_nothing_at_all() {
    // Not an empty block with a heading: a model handed "here is what you know"
    // followed by nothing will invent something to have known.
    assert!(read_shared_memory(Some(&FakeRepo::empty()), "me").await.is_none());
    assert!(
        read_shared_memory(Some(&FakeRepo::holding(r#"{"user":"   ","agent":""}"#)), "me")
            .await
            .is_none()
    );
}

#[tokio::test]
async fn a_memory_that_cannot_be_read_does_not_stop_a_conversation() {
    // Every one of these once had a plausible argument for being an error. None
    // of them is worth refusing to talk to somebody over.
    assert!(read_shared_memory(None, "me").await.is_none());
    assert!(read_shared_memory(Some(&FakeRepo::broken()), "me").await.is_none());
    assert!(
        read_shared_memory(Some(&FakeRepo::holding("not json at all")), "me")
            .await
            .is_none()
    );
}

#[test]
fn the_memory_is_read_before_the_rules_that_depend_on_it() {
    let joined = prepend(Some("<user-memory>x</user-memory>".into()), Some("Be concise.".into()));

    assert_eq!(joined.as_deref(), Some("<user-memory>x</user-memory>\n\nBe concise."));
}

#[test]
fn either_half_missing_leaves_the_other_untouched() {
    assert_eq!(
        prepend(None, Some("Be concise.".into())).as_deref(),
        Some("Be concise.")
    );
    assert_eq!(prepend(Some("memory".into()), None).as_deref(), Some("memory"));
    assert_eq!(prepend(None, None), None);
}
