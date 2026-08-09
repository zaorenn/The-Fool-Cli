use super::*;
use std::fs;

fn workspace() -> (tempfile::TempDir, CheckpointStore) {
    let dir = tempfile::tempdir().expect("a temp dir");
    let store = CheckpointStore::new(dir.path().join(".checkpoints"));
    (dir, store)
}

#[test]
fn a_file_can_be_put_back_as_it_was() {
    let (dir, mut store) = workspace();
    let file = dir.path().join("notes.txt");
    fs::write(&file, "before").expect("write");

    store.take("turn-1", &file).expect("checkpoint");
    fs::write(&file, "after").expect("overwrite");
    assert_eq!(fs::read_to_string(&file).unwrap(), "after");

    assert!(store.restore("turn-1").is_empty());
    assert_eq!(fs::read_to_string(&file).unwrap(), "before");
}

#[test]
fn undoing_a_created_file_removes_it() {
    let (dir, mut store) = workspace();
    let file = dir.path().join("new.txt");

    // Recorded with no copy: undoing a creation means deleting, and without the
    // record there would be nothing to say this turn made it.
    store.take("turn-1", &file).expect("checkpoint");
    fs::write(&file, "made by the agent").expect("write");

    assert!(store.restore("turn-1").is_empty());
    assert!(!file.exists());
}

#[test]
fn a_file_touched_twice_goes_back_to_before_the_first_change() {
    let (dir, mut store) = workspace();
    let file = dir.path().join("notes.txt");
    fs::write(&file, "original").expect("write");

    store.take("turn-1", &file).expect("first");
    fs::write(&file, "middle").expect("write");
    store.take("turn-1", &file).expect("second");
    fs::write(&file, "final").expect("write");

    store.restore("turn-1");
    // "Undo that turn" means the state before the turn, not before its last edit.
    assert_eq!(fs::read_to_string(&file).unwrap(), "original");
}

#[test]
fn one_turn_does_not_undo_another() {
    let (dir, mut store) = workspace();
    let first = dir.path().join("a.txt");
    let second = dir.path().join("b.txt");
    fs::write(&first, "a before").expect("write");
    fs::write(&second, "b before").expect("write");

    store.take("turn-1", &first).expect("checkpoint");
    fs::write(&first, "a after").expect("write");
    store.take("turn-2", &second).expect("checkpoint");
    fs::write(&second, "b after").expect("write");

    store.restore("turn-1");

    assert_eq!(fs::read_to_string(&first).unwrap(), "a before");
    assert_eq!(fs::read_to_string(&second).unwrap(), "b after");
}

#[test]
fn restoring_reports_what_it_could_not_put_back() {
    let (dir, mut store) = workspace();
    let file = dir.path().join("notes.txt");
    fs::write(&file, "before").expect("write");
    store.take("turn-1", &file).expect("checkpoint");

    // The copy is destroyed behind the store's back, which is what a user
    // clearing a temp folder looks like.
    for entry in store.for_turn("turn-1") {
        if let Some(copy) = &entry.copy {
            fs::remove_file(copy).expect("remove the copy");
        }
    }

    let failures = store.restore("turn-1");
    // Reported rather than swallowed: a rollback that silently did nothing is
    // worse than one that says it failed.
    assert_eq!(failures.len(), 1);
}

#[test]
fn the_turns_that_can_be_undone_are_listed_newest_first() {
    let (dir, mut store) = workspace();
    let file = dir.path().join("notes.txt");
    fs::write(&file, "x").expect("write");

    store.take("turn-1", &file).expect("checkpoint");
    store.take("turn-2", &file).expect("checkpoint");

    assert_eq!(store.turns(), vec!["turn-2".to_string(), "turn-1".to_string()]);
}

#[test]
fn a_file_too_large_to_copy_is_recorded_without_one() {
    let (dir, mut store) = workspace();
    let file = dir.path().join("huge.bin");
    fs::write(&file, vec![0_u8; (MAX_FILE_BYTES + 1) as usize]).expect("write");

    let taken = store.take("turn-1", &file).expect("checkpoint");
    // Honest rather than refusing: the agent may still edit it, and the record
    // says plainly that this one cannot be undone.
    assert!(taken.copy.is_none());
}
