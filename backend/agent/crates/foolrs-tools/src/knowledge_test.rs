use super::*;

fn workspace() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

/// A key, not a title.
///
/// Two spellings of the same thing must be the same memory. Otherwise a fact
/// that changes produces two entries that contradict each other, and a memory
/// directory holding both "the tests are run with bun" and "the tests are run
/// with npm" is worse than one holding neither.
#[test]
fn a_name_becomes_a_key_two_spellings_agree_on() {
    assert_eq!(memory_key("Test Command"), "test-command");
    assert_eq!(memory_key("test-command"), "test-command");
    assert_eq!(memory_key("  Test   Command!  "), "test-command");
    assert_eq!(memory_key("How the DB layer works"), "how-the-db-layer-works");
}

#[test]
fn a_name_with_nothing_usable_in_it_makes_no_key() {
    assert_eq!(memory_key("   "), "");
    assert_eq!(memory_key("!!!"), "");
}

#[tokio::test]
async fn writing_twice_under_one_name_corrects_rather_than_contradicts() {
    let dir = workspace();
    let tool = RememberTool::new(dir.path().to_path_buf());

    let first = tool
        .execute(json!({
            "name": "Test command",
            "kind": "project",
            "description": "How are the tests run here?",
            "content": "bun run test"
        }))
        .await;
    assert!(!first.is_error, "{}", first.content);

    let second = tool
        .execute(json!({
            "name": "test-command",
            "kind": "project",
            "description": "How are the tests run here?",
            "content": "vitest, through the worktree's own binary"
        }))
        .await;
    assert!(!second.is_error, "{}", second.content);

    let files: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(files.len(), 1, "one fact must be one file, got {files:?}");

    let recalled = RecallTool::new(dir.path().to_path_buf())
        .execute(json!({ "name": "Test command" }))
        .await;
    assert!(recalled.content.contains("vitest"), "got: {}", recalled.content);
    assert!(!recalled.content.contains("bun run test"));
}

/// The description is the only part a future session reads before deciding
/// whether to open the entry. Without one, the memory is written and never
/// recalled — which is worse than refusing, because nobody finds out.
#[tokio::test]
async fn an_entry_with_no_description_is_refused_rather_than_written() {
    let dir = workspace();
    let tool = RememberTool::new(dir.path().to_path_buf());

    let result = tool
        .execute(json!({ "name": "x", "kind": "project", "description": "  ", "content": "something" }))
        .await;

    assert!(result.is_error);
    assert!(result.content.contains("never recalled"), "got: {}", result.content);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn a_kind_that_is_not_one_of_the_four_is_refused() {
    let dir = workspace();
    let result = RememberTool::new(dir.path().to_path_buf())
        .execute(json!({ "name": "x", "kind": "whatever", "description": "d", "content": "c" }))
        .await;

    assert!(result.is_error);
    assert!(result.content.contains("user, feedback, project, reference"));
}

/// Models send the word rather than the enum about as often as not, and the
/// words they reach for are the ones the description uses.
#[tokio::test]
async fn the_words_a_model_actually_sends_are_understood() {
    let dir = workspace();
    let tool = RememberTool::new(dir.path().to_path_buf());

    for kind in [
        "architecture",
        "procedure",
        "snippet",
        "correction",
        "lesson",
        "preference",
        "link",
    ] {
        let result = tool
            .execute(json!({ "name": kind, "kind": kind, "description": "d", "content": "c" }))
            .await;
        assert!(!result.is_error, "{kind} was refused: {}", result.content);
    }
}

/// Memory is read on every turn of every future session, so an entry is paid
/// for many times over.
#[tokio::test]
async fn an_entry_too_long_to_carry_is_refused_with_the_reason() {
    let dir = workspace();
    let result = RememberTool::new(dir.path().to_path_buf())
        .execute(json!({
            "name": "big",
            "kind": "project",
            "description": "d",
            "content": "x".repeat(MAX_CONTENT + 1)
        }))
        .await;

    assert!(result.is_error);
    assert!(
        result.content.contains("every future session"),
        "got: {}",
        result.content
    );
}

#[tokio::test]
async fn recall_lists_what_is_there_when_asked_for_nothing_in_particular() {
    let dir = workspace();
    let remember = RememberTool::new(dir.path().to_path_buf());
    remember
        .execute(json!({ "name": "one", "kind": "project", "description": "the first thing", "content": "a" }))
        .await;
    remember
        .execute(json!({ "name": "two", "kind": "user", "description": "the second thing", "content": "b" }))
        .await;

    let listed = RecallTool::new(dir.path().to_path_buf()).execute(json!({})).await;

    assert!(!listed.is_error);
    assert!(listed.content.contains("the first thing"));
    assert!(listed.content.contains("the second thing"));
}

/// Absence is reported as absence, not as a fact about the world.
#[tokio::test]
async fn recalling_something_nobody_wrote_says_so_without_calling_it_untrue() {
    let dir = workspace();
    let result = RecallTool::new(dir.path().to_path_buf())
        .execute(json!({ "name": "never written" }))
        .await;

    assert!(!result.is_error, "an absent memory is an answer, not a failure");
    assert!(
        result.content.contains("not that it is untrue"),
        "got: {}",
        result.content
    );
}

#[tokio::test]
async fn an_empty_memory_directory_says_nothing_has_been_remembered() {
    let dir = workspace();
    let result = RecallTool::new(dir.path().to_path_buf()).execute(json!({})).await;
    assert!(!result.is_error);
    assert!(result.content.contains("Nothing has been remembered"));
}

#[test]
fn writing_a_memory_counts_as_editing_and_reading_one_does_not() {
    // The permission layer reads these. One creates a file on the user's disk;
    // the other opens something already there.
    let dir = workspace();
    assert_eq!(
        RememberTool::new(dir.path().to_path_buf()).category(),
        ToolCategory::Edit
    );
    assert_eq!(RecallTool::new(dir.path().to_path_buf()).category(), ToolCategory::Info);
}

/// A shorter key must not open a longer one.
///
/// The prefix is stripped and the rest compared exactly, so `command` is not
/// answered with whatever `test-command` says. A recall that returns the wrong
/// memory is worse than one that returns none: the model reports it as fact.
#[tokio::test]
async fn a_partial_name_does_not_open_a_different_memory() {
    let dir = workspace();
    RememberTool::new(dir.path().to_path_buf())
        .execute(json!({
            "name": "test command",
            "kind": "project",
            "description": "d",
            "content": "bun run test"
        }))
        .await;

    let result = RecallTool::new(dir.path().to_path_buf())
        .execute(json!({ "name": "command" }))
        .await;

    assert!(
        result.content.contains("Nothing is remembered"),
        "a partial key must not open a different memory, got: {}",
        result.content
    );
}
