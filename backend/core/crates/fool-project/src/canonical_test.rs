use super::*;

/// Every URI here goes through `test_uri`, which puts a drive letter in front
/// on Windows. Without it these are POSIX paths the host cannot name, and the
/// assertion under test never runs.
fn uri(posix_path: &str) -> String {
    test_uri(posix_path)
}

#[test]
fn drops_trailing_slash() {
    assert_eq!(
        canonicalize(&uri("/a/b/")).unwrap(),
        canonicalize(&uri("/a/b")).unwrap()
    );
}

#[test]
fn resolves_dot_dot_lexically() {
    assert_eq!(
        canonicalize(&uri("/a/b/../c")).unwrap(),
        canonicalize(&uri("/a/c")).unwrap()
    );
}

#[test]
fn resolves_single_dot() {
    assert_eq!(
        canonicalize(&uri("/a/./b")).unwrap(),
        canonicalize(&uri("/a/b")).unwrap()
    );
}

#[test]
fn collapses_repeated_separators() {
    assert_eq!(
        canonicalize(&uri("/a//b")).unwrap(),
        canonicalize(&uri("/a/b")).unwrap()
    );
}

#[test]
fn dot_dot_above_root_is_clamped_not_errored() {
    // Lexical clamp to root; containment (not canonicalize) rejects escapes.
    assert_eq!(
        canonicalize(&uri("/../../a")).unwrap(),
        canonicalize(&uri("/a")).unwrap()
    );
}

#[test]
fn is_deterministic() {
    let a = canonicalize(&uri("/Users/me/proj")).unwrap();
    let b = canonicalize(&uri("/Users/me/proj")).unwrap();
    assert_eq!(a, b);
}

#[test]
fn casing_folds_per_platform() {
    let mixed = canonicalize(&uri("/Users/Me/Fool")).unwrap();
    let lower = canonicalize(&uri("/users/me/fool")).unwrap();
    if IGNORE_PATH_CASING {
        // macOS / Windows: same folder.
        assert_eq!(mixed, lower);
        // Only the path folds. A Windows drive letter is normalised back to
        // upper case by the URL layer, which is why this compares against the
        // helper's output rather than a lower-cased copy of it.
        assert_eq!(mixed.as_str(), uri("/users/me/fool"));
    } else {
        // Linux: two distinct folders.
        assert_ne!(mixed, lower);
    }
}

#[test]
fn symlink_dir_is_not_its_target_lexically() {
    // Pure lexical identity: two distinct path strings are two distinct
    // folders regardless of any on-disk symlink relationship.
    let link = canonicalize(&uri("/a/link")).unwrap();
    let target = canonicalize(&uri("/a/target")).unwrap();
    assert_ne!(link, target);
}

#[test]
fn unsupported_scheme_is_rejected() {
    let err = canonicalize("ssh://host/home/me/project").unwrap_err();
    assert_eq!(err.code(), "unsupported_resource_scheme");
}

#[test]
fn parse_scheme_accepts_file_rejects_others() {
    assert_eq!(parse_scheme("file:///a").unwrap(), Scheme::File);
    assert_eq!(
        parse_scheme("ssh://h/p").unwrap_err().code(),
        "unsupported_resource_scheme"
    );
}

#[test]
fn basename_is_final_segment() {
    let c = canonicalize(&uri("/Users/me/fool")).unwrap();
    assert_eq!(basename(&c), "fool");
}

#[test]
fn fs_path_roundtrips_canonical() {
    let c = canonicalize(&uri("/Users/me/fool")).unwrap();
    let p = fs_path(&c).unwrap();
    // Re-deriving the file uri from the path reproduces the canonical string.
    assert_eq!(to_file_uri(&p).unwrap(), c.as_str());
}

#[test]
fn to_file_uri_does_not_fold_casing() {
    // to_file_uri is raw capture, not identity: casing is preserved.
    let captured = to_file_uri(&test_path("/Users/Me/Fool")).unwrap();
    assert_eq!(captured, test_uri("/Users/Me/Fool"));
}
