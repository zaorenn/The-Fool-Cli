//! A directory a conversation cannot write outside of.
//!
//! Chosen per conversation, because the assistant's whole purpose is the real
//! machine: "play my favourite song", "fill in this PDF", "install that" all
//! need it, and a sandbox that makes them impossible has not made the product
//! safer, it has made it a different product. So this is offered, not imposed.
//!
//! **What this is not.** It is not a VM, not a container, and not a security
//! boundary against somebody who is trying. `ExecCommand` runs a shell, and a
//! shell can write wherever the user running it can — confinement narrows the
//! working directory it starts in and nothing more. What this stops is a
//! *mistake*: an agent that misreads a path, follows a symlink out of the
//! project, or takes an instruction from a page it was reading. That is the
//! failure that actually happens.
//!
//! Anything stronger has to come from the operating system, and choosing which
//! mechanism — a container, WSL, a job object — is a decision nobody has taken.
//! Until then this says exactly what it is, and the interface must not say more.

use std::path::{Path, PathBuf};

/// Where a conversation may write.
#[derive(Debug, Clone, Default)]
pub enum Confinement {
    /// The real machine. What the product is for, and the default.
    #[default]
    None,
    /// Writes are refused outside this directory.
    Within(PathBuf),
}

impl Confinement {
    pub fn within(root: impl Into<PathBuf>) -> Self {
        Self::Within(root.into())
    }

    /// Whether a path may be written to.
    ///
    /// Symlinks are resolved as far as the filesystem allows before the
    /// comparison, because a link inside the directory pointing out of it is
    /// precisely how a lexical check gets walked around — and it is a shape
    /// that occurs by accident in any project with a `node_modules`.
    pub fn allows_write(&self, path: &Path) -> bool {
        let Self::Within(root) = self else { return true };

        let Some(resolved) = resolve_as_far_as_possible(path) else {
            // A path that cannot be resolved at all is refused: not knowing
            // where something points is not a reason to write to it.
            return false;
        };
        let Some(resolved_root) = resolve_as_far_as_possible(root) else {
            return false;
        };

        resolved.starts_with(&resolved_root)
    }

    /// What to tell the model, in words it can repeat.
    pub fn refusal(&self, path: &Path) -> String {
        match self {
            Self::None => String::new(),
            Self::Within(root) => format!(
                "This conversation may only write inside {}; {} is outside it.",
                root.display(),
                path.display()
            ),
        }
    }

    pub fn root(&self) -> Option<&Path> {
        match self {
            Self::None => None,
            Self::Within(root) => Some(root.as_path()),
        }
    }
}

/// The path with every existing part of it resolved.
///
/// `canonicalize` fails on a path that does not exist yet, which is most of
/// what `Write` is handed. So the deepest ancestor that does exist is resolved
/// and the rest is appended — which still defeats a symlinked *parent*, the
/// case that matters.
fn resolve_as_far_as_possible(path: &Path) -> Option<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().ok()?.join(path)
    };

    let mut remainder: Vec<std::ffi::OsString> = Vec::new();
    let mut candidate = absolute.as_path();

    loop {
        if let Ok(resolved) = candidate.canonicalize() {
            let mut out = resolved;
            for part in remainder.iter().rev() {
                out.push(part);
            }
            return Some(normalise_verbatim(out));
        }
        let name = candidate.file_name()?;
        remainder.push(name.to_os_string());
        candidate = candidate.parent()?;
    }
}

/// Drops Windows' `\\?\` prefix, which `canonicalize` adds and `starts_with`
/// then compares against a path that does not have it.
fn normalise_verbatim(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => path,
    }
}

#[cfg(test)]
#[path = "confinement_test.rs"]
mod confinement_test;
