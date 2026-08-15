//! What the list has to do to be worth carrying.
//!
//! The failure this tool exists to prevent is not an error — it is a long task
//! reported as finished with two steps quietly missing. So the tests are about
//! the list staying true rather than about it being stored.

use super::*;
use serde_json::json;

async fn write(tool: &TodoTool, todos: Value) -> ToolResult {
    tool.execute(json!({ "todos": todos })).await
}

#[tokio::test]
async fn reads_the_whole_list_back_so_it_is_not_reconstructed_from_memory() {
    let tool = TodoTool::new();

    let result = write(
        &tool,
        json!([
            { "content": "read the failing test", "status": "completed" },
            { "content": "make it pass", "status": "in_progress" },
            { "content": "run the suite", "status": "pending" },
        ]),
    )
    .await;

    assert!(!result.is_error, "{}", result.content);
    // Every item, not a count and not an acknowledgement: a tool that answered
    // "saved" would leave the model rebuilding the list from the transcript,
    // which is the thing it was added to stop.
    assert!(result.content.contains("read the failing test"));
    assert!(result.content.contains("make it pass"));
    assert!(result.content.contains("run the suite"));
    assert!(result.content.contains("1/3 done"));
}

#[tokio::test]
async fn names_what_is_being_worked_on_now() {
    let tool = TodoTool::new();

    let result = write(
        &tool,
        json!([
            { "content": "first", "status": "completed" },
            { "content": "second", "status": "in_progress" },
        ]),
    )
    .await;

    assert!(result.content.contains("On now: second"), "{}", result.content);
}

#[tokio::test]
async fn says_when_nothing_is_in_progress_and_work_remains() {
    let tool = TodoTool::new();

    let result = write(
        &tool,
        json!([
            { "content": "first", "status": "completed" },
            { "content": "second", "status": "pending" },
        ]),
    )
    .await;

    // The state a model lands in after finishing an item and forgetting to pick
    // up the next one. Left unsaid, the next turn starts with no current step.
    assert!(
        result.content.contains("Nothing is marked in progress"),
        "{}",
        result.content
    );
}

#[tokio::test]
async fn refuses_more_than_one_thing_in_progress() {
    let tool = TodoTool::new();

    let result = write(
        &tool,
        json!([
            { "content": "first", "status": "in_progress" },
            { "content": "second", "status": "in_progress" },
        ]),
    )
    .await;

    assert!(result.is_error);
    assert!(result.content.contains("in progress"), "{}", result.content);
    // And the refused write left the previous list alone.
    assert!(tool.items().is_empty());
}

#[tokio::test]
async fn replaces_the_list_rather_than_appending_to_it() {
    let tool = TodoTool::new();

    write(&tool, json!([{ "content": "old plan", "status": "pending" }])).await;
    let result = write(&tool, json!([{ "content": "new plan", "status": "pending" }])).await;

    assert!(!result.content.contains("old plan"), "{}", result.content);
    assert_eq!(tool.items().len(), 1);
    assert_eq!(tool.items()[0].content, "new plan");
}

#[tokio::test]
async fn takes_a_bare_string_as_a_pending_item() {
    let tool = TodoTool::new();

    // Small local models send this shape often enough that refusing it would
    // reject a perfectly clear plan on a technicality.
    let result = write(&tool, json!(["write the test", "make it pass"])).await;

    assert!(!result.is_error, "{}", result.content);
    assert_eq!(tool.items().len(), 2);
    assert_eq!(tool.items()[0].status, TodoStatus::Pending);
}

#[tokio::test]
async fn accepts_the_words_models_use_for_the_statuses() {
    let tool = TodoTool::new();

    let result = write(
        &tool,
        json!([
            { "content": "a", "status": "done" },
            { "content": "b", "status": "doing" },
            { "content": "c", "status": "todo" },
        ]),
    )
    .await;

    assert!(!result.is_error, "{}", result.content);
    assert_eq!(tool.items()[0].status, TodoStatus::Completed);
    assert_eq!(tool.items()[1].status, TodoStatus::InProgress);
    assert_eq!(tool.items()[2].status, TodoStatus::Pending);
}

#[tokio::test]
async fn refuses_a_status_it_cannot_place() {
    let tool = TodoTool::new();

    let result = write(&tool, json!([{ "content": "a", "status": "nearly" }])).await;

    // Not silently treated as pending: "nearly" meant something to whoever
    // wrote it, and guessing wrong marks unfinished work as not started.
    assert!(result.is_error);
    assert!(result.content.contains("nearly"), "{}", result.content);
}

#[tokio::test]
async fn refuses_an_item_with_nothing_in_it() {
    let tool = TodoTool::new();

    let result = write(&tool, json!([{ "content": "   ", "status": "pending" }])).await;

    assert!(result.is_error);
}

#[tokio::test]
async fn refuses_a_list_too_long_to_carry_every_turn() {
    let tool = TodoTool::new();
    let many: Vec<Value> = (0..MAX_ITEMS + 1)
        .map(|n| json!({ "content": format!("step {n}"), "status": "pending" }))
        .collect();

    let result = write(&tool, json!(many)).await;

    assert!(result.is_error);
    assert!(result.content.contains(&MAX_ITEMS.to_string()), "{}", result.content);
}

#[tokio::test]
async fn says_when_the_whole_list_is_done() {
    let tool = TodoTool::new();

    let result = write(&tool, json!([{ "content": "only step", "status": "completed" }])).await;

    assert!(result.content.contains("Everything on the list is done"), "{}", result.content);
}

#[tokio::test]
async fn needs_no_permission_because_it_changes_nothing_outside_the_agent() {
    let tool = TodoTool::new();

    // A permission prompt for writing down what you intend to do would be a
    // prompt for thinking.
    assert_eq!(tool.category(), ToolCategory::Info);
}
