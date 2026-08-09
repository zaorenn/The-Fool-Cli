//! The tools take a checkpoint, and a turn can be undone.
//!
//! The store has its own tests. This one is about the wiring: that `Write` and
//! `Edit` actually reach for it before they change anything, which is the
//! difference between having a rollback and having the machinery for one.

use std::sync::{Arc, Mutex};

use foolrs_tools::Tool;
use foolrs_tools::checkpoint::CheckpointStore;
use foolrs_tools::edit::EditTool;
use foolrs_tools::write::WriteTool;
use serde_json::json;

fn store(root: &std::path::Path) -> Arc<Mutex<CheckpointStore>> {
    Arc::new(Mutex::new(CheckpointStore::new(root.join(".checkpoints"))))
}

#[tokio::test]
async fn a_write_can_be_undone() {
    let dir = tempfile::tempdir().expect("temp dir");
    let file = dir.path().join("notes.txt");
    std::fs::write(&file, "before").expect("write");

    let checkpoints = store(dir.path());
    checkpoints.lock().unwrap().begin_turn("turn-1");
    let tool = WriteTool::new(None).with_checkpoints(checkpoints.clone());

    let result = tool
        .execute(json!({ "file_path": file.to_string_lossy(), "content": "after" }))
        .await;
    assert!(!result.is_error, "{}", result.content);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "after");

    assert!(checkpoints.lock().unwrap().restore("turn-1").is_empty());
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "before");
}

#[tokio::test]
async fn a_created_file_can_be_undone() {
    let dir = tempfile::tempdir().expect("temp dir");
    let file = dir.path().join("new.txt");

    let checkpoints = store(dir.path());
    checkpoints.lock().unwrap().begin_turn("turn-1");
    let tool = WriteTool::new(None).with_checkpoints(checkpoints.clone());

    tool.execute(json!({ "file_path": file.to_string_lossy(), "content": "made" }))
        .await;
    assert!(file.exists());

    checkpoints.lock().unwrap().restore("turn-1");
    assert!(!file.exists());
}

#[tokio::test]
async fn an_edit_can_be_undone() {
    let dir = tempfile::tempdir().expect("temp dir");
    let file = dir.path().join("notes.txt");
    std::fs::write(&file, "hello world").expect("write");

    let checkpoints = store(dir.path());
    checkpoints.lock().unwrap().begin_turn("turn-2");
    let tool = EditTool::new(None).with_checkpoints(checkpoints.clone());

    let result = tool
        .execute(json!({
            "file_path": file.to_string_lossy(),
            "old_string": "world",
            "new_string": "there",
        }))
        .await;
    assert!(!result.is_error, "{}", result.content);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "hello there");

    checkpoints.lock().unwrap().restore("turn-2");
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "hello world");
}

#[tokio::test]
async fn a_tool_without_a_store_still_works() {
    // The CLI and the tests run without one, and an agent that refused to write
    // because nobody wired a checkpoint would be worse than one that cannot be
    // undone.
    let dir = tempfile::tempdir().expect("temp dir");
    let file = dir.path().join("notes.txt");

    let result = WriteTool::new(None)
        .execute(json!({ "file_path": file.to_string_lossy(), "content": "written" }))
        .await;

    assert!(!result.is_error, "{}", result.content);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "written");
}

#[tokio::test]
async fn a_confined_conversation_cannot_write_outside_its_directory() {
    let inside = tempfile::tempdir().expect("temp dir");
    let outside = tempfile::tempdir().expect("another temp dir");
    let escapee = outside.path().join("secret.txt");

    let tool = WriteTool::new(None).confined_to(foolrs_tools::confinement::Confinement::within(inside.path()));

    let result = tool
        .execute(json!({ "file_path": escapee.to_string_lossy(), "content": "should not land" }))
        .await;

    assert!(result.is_error, "{}", result.content);
    assert!(!escapee.exists());
}

#[tokio::test]
async fn a_confined_conversation_still_writes_inside_it() {
    let inside = tempfile::tempdir().expect("temp dir");
    let file = inside.path().join("nested/notes.txt");

    let tool = WriteTool::new(None).confined_to(foolrs_tools::confinement::Confinement::within(inside.path()));

    let result = tool
        .execute(json!({ "file_path": file.to_string_lossy(), "content": "fine" }))
        .await;

    assert!(!result.is_error, "{}", result.content);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "fine");
}

#[tokio::test]
async fn an_edit_outside_the_directory_is_refused() {
    let inside = tempfile::tempdir().expect("temp dir");
    let outside = tempfile::tempdir().expect("another temp dir");
    let file = outside.path().join("notes.txt");
    std::fs::write(&file, "hello world").expect("write");

    let tool = EditTool::new(None).confined_to(foolrs_tools::confinement::Confinement::within(inside.path()));

    let result = tool
        .execute(json!({
            "file_path": file.to_string_lossy(),
            "old_string": "world",
            "new_string": "there",
        }))
        .await;

    assert!(result.is_error, "{}", result.content);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "hello world");
}
