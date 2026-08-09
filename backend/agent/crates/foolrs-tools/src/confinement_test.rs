use super::*;

#[test]
fn the_real_machine_allows_everything() {
    // The default, because the product exists to act on the real machine.
    let free = Confinement::None;
    assert!(free.allows_write(Path::new("C:/Windows/system32/x.dll")));
    assert!(free.allows_write(Path::new("/etc/passwd")));
}

#[test]
fn a_file_inside_the_directory_is_allowed() {
    let dir = tempfile::tempdir().expect("temp dir");
    let confined = Confinement::within(dir.path());

    assert!(confined.allows_write(&dir.path().join("notes.txt")));
    assert!(confined.allows_write(&dir.path().join("nested/deep/new.txt")));
}

#[test]
fn a_file_outside_the_directory_is_refused() {
    let dir = tempfile::tempdir().expect("temp dir");
    let elsewhere = tempfile::tempdir().expect("another temp dir");
    let confined = Confinement::within(dir.path());

    assert!(!confined.allows_write(&elsewhere.path().join("notes.txt")));
}

#[test]
fn dot_dot_does_not_walk_out() {
    let dir = tempfile::tempdir().expect("temp dir");
    let confined = Confinement::within(dir.path());

    assert!(!confined.allows_write(&dir.path().join("../escaped.txt")));
    assert!(!confined.allows_write(&dir.path().join("a/../../escaped.txt")));
}

#[test]
fn a_sibling_whose_name_starts_the_same_is_refused() {
    // `work` must not cover `workspace`. Comparing strings rather than path
    // components is how a directory rule turns into a rule about a prefix.
    let parent = tempfile::tempdir().expect("temp dir");
    let work = parent.path().join("work");
    let workspace = parent.path().join("workspace");
    std::fs::create_dir_all(&work).expect("mkdir");
    std::fs::create_dir_all(&workspace).expect("mkdir");

    let confined = Confinement::within(&work);
    assert!(!confined.allows_write(&workspace.join("secret.txt")));
}

#[test]
fn the_refusal_says_where_the_boundary_is() {
    let confined = Confinement::within("D:/project");
    let message = confined.refusal(Path::new("D:/elsewhere/x.txt"));

    assert!(message.contains("D:/project"));
    assert!(message.contains("outside"));
}

#[cfg(windows)]
#[test]
fn a_symlink_out_of_the_directory_is_refused() {
    // The case a lexical check cannot see, and the one that occurs by accident
    // in any project with linked dependencies. Creating a symlink needs
    // privileges on Windows; when it is refused there is nothing to assert, and
    // saying so beats a test that silently proves nothing.
    let parent = tempfile::tempdir().expect("temp dir");
    let inside = parent.path().join("inside");
    let outside = parent.path().join("outside");
    std::fs::create_dir_all(&inside).expect("mkdir");
    std::fs::create_dir_all(&outside).expect("mkdir");

    let link = inside.join("escape");
    if std::os::windows::fs::symlink_dir(&outside, &link).is_err() {
        eprintln!("symlink creation not permitted; skipping the symlink escape check");
        return;
    }

    let confined = Confinement::within(&inside);
    assert!(!confined.allows_write(&link.join("secret.txt")));
}
