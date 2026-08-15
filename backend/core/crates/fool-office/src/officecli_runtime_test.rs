use super::*;

fn write_marker_file(path: &std::path::Path) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, b"#!/bin/sh\nexit 0\n").unwrap();
}

/// The binary the application shipped wins over whatever the user installed.
///
/// A copy on `PATH` is some other version, chosen by somebody else, possibly
/// years old. Silently preferring it makes this application's Office behaviour
/// depend on a thing nobody here picked.
#[test]
fn the_bundled_binary_wins_over_anything_on_path() {
    let tmp = tempfile::tempdir().unwrap();
    let bundled = tmp.path().join("resources").join("officecli");
    let on_path = tmp.path().join("path-bin").join("officecli");
    write_marker_file(&bundled);
    write_marker_file(&on_path);

    let path_env = std::env::join_paths([on_path.parent().unwrap()]).unwrap();
    let resolved =
        resolve_officecli_path_from_env_for_test(Some(bundled.as_os_str()), Some(&path_env), None, None);

    assert_eq!(resolved, Some(bundled));
}

/// A variable pointing at a file that is no longer there must not win.
///
/// An upgrade that moves the binary would otherwise take precedence over a
/// working copy on `PATH` and turn a working install into a broken one.
#[test]
fn a_stale_bundled_path_falls_through_rather_than_winning() {
    let tmp = tempfile::tempdir().unwrap();
    let missing = tmp.path().join("gone").join("officecli");
    let on_path = tmp.path().join("path-bin").join("officecli");
    write_marker_file(&on_path);

    let path_env = std::env::join_paths([on_path.parent().unwrap()]).unwrap();
    let resolved =
        resolve_officecli_path_from_env_for_test(Some(missing.as_os_str()), Some(&path_env), None, None);

    assert_eq!(resolved, Some(on_path));
}

#[test]
fn officecli_resolution_discovers_windows_installer_location() {
    let tmp = tempfile::tempdir().unwrap();
    let local_app_data = tmp.path().join("LocalAppData");
    let officecli_exe = local_app_data.join("OfficeCli").join("officecli.exe");
    std::fs::create_dir_all(officecli_exe.parent().unwrap()).unwrap();
    std::fs::write(&officecli_exe, b"fake exe").unwrap();

    let resolved = resolve_officecli_path_from_env_for_test(None, None, None, Some(&local_app_data));

    assert_eq!(resolved, Some(officecli_exe));
}

#[test]
fn nothing_is_found_when_nothing_is_installed() {
    // Missing must be reported as missing. The alternative this replaced was
    // downloading a script from the internet and executing it.
    assert_eq!(resolve_officecli_path_from_env_for_test(None, None, None, None), None);
}

/// The regression this file exists to hold.
///
/// `irm https://…/install.ps1 | iex` executed an unverified remote script on
/// the user's machine, and it ran whenever a Word document was previewed. No
/// code path here may bring it back.
#[test]
fn no_code_path_downloads_and_executes_a_remote_script() {
    let source = include_str!("officecli_runtime.rs");
    let code: String = source
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");

    assert!(!code.contains("install.ps1"), "the remote installer must not return");
    assert!(!code.contains("install.sh"), "the remote installer must not return");
    assert!(!code.contains("iex"), "no remote script may be executed");
    assert!(!code.contains("d.officecli.ai"), "no installer mirror may be fetched");
}
