//! What a file looked like before this turn touched it.
//!
//! An agent that overwrites a file while somebody is talking to it has simply
//! overwritten it: there is nothing in this application to go back to, and both
//! of the editors it is compared with ship checkpoint-and-revert. This is the
//! smallest thing that closes that.
//!
//! Copies rather than a git commit, deliberately. The workspace may not be a
//! repository; it may be one with staged work the user cares about; it may be a
//! Documents folder where committing would be an intrusion. A checkpoint that
//! quietly rewrites somebody's git history to protect them from an agent is its
//! own incident.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// One file, as it was before a turn changed it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Checkpoint {
    /// The turn that is about to write. Every file it touches shares this.
    pub turn_id: String,
    /// Where the file lives.
    pub original: PathBuf,
    /// Where the copy lives, or `None` when the file did not exist yet.
    pub copy: Option<PathBuf>,
    pub taken_at_ms: u128,
}

/// Why a checkpoint could not be taken.
#[derive(Debug)]
pub enum CheckpointError {
    /// The copy could not be written, so the change must not go ahead.
    Failed(String),
}

impl std::fmt::Display for CheckpointError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Failed(why) => write!(f, "could not take a checkpoint: {why}"),
        }
    }
}

/// The most that is kept before the oldest is dropped.
///
/// Bounded because a long session on a large workspace would otherwise copy
/// the workspace, and a checkpoint nobody can afford to keep is one that gets
/// switched off.
const MAX_CHECKPOINTS: usize = 200;

/// The most a single file may be, to be worth copying.
///
/// Sixteen megabytes covers source, documents and configuration — the things an
/// agent edits. A checkpoint of a video is not a safety feature.
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;

/// Where the copies live, and what has been kept.
pub struct CheckpointStore {
    root: PathBuf,
    kept: Vec<Checkpoint>,
}

impl CheckpointStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            kept: Vec::new(),
        }
    }

    /// Copies a file aside before this turn changes it.
    ///
    /// A file that does not exist yet is still recorded, with no copy: undoing
    /// its creation means deleting it, and without the record there would be
    /// nothing to say it was this turn that made it.
    ///
    /// **A failure here is a refusal, not a warning.** If the copy cannot be
    /// written, the change must not go ahead — a checkpoint that silently did
    /// not happen is worse than none, because the user believes there is a way
    /// back.
    pub fn take(&mut self, turn_id: &str, original: &Path) -> Result<&Checkpoint, CheckpointError> {
        let taken_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|since| since.as_millis())
            .unwrap_or(0);

        let copy = if original.exists() {
            let size = fs::metadata(original)
                .map_err(|error| CheckpointError::Failed(error.to_string()))?
                .len();
            if size > MAX_FILE_BYTES {
                // Recorded without a copy rather than refused: refusing would
                // stop the agent editing a large file at all, and the honest
                // position is that this one cannot be undone.
                None
            } else {
                let destination = self.destination(turn_id, original, taken_at_ms);
                if let Some(parent) = destination.parent() {
                    fs::create_dir_all(parent).map_err(|error| CheckpointError::Failed(error.to_string()))?;
                }
                fs::copy(original, &destination).map_err(|error| CheckpointError::Failed(error.to_string()))?;
                Some(destination)
            }
        } else {
            None
        };

        self.kept.push(Checkpoint {
            turn_id: turn_id.to_string(),
            original: original.to_path_buf(),
            copy,
            taken_at_ms,
        });

        // Oldest first, because the turn somebody wants to undo is almost
        // always a recent one.
        while self.kept.len() > MAX_CHECKPOINTS {
            let dropped = self.kept.remove(0);
            if let Some(copy) = dropped.copy {
                let _ = fs::remove_file(copy);
            }
        }

        Ok(self.kept.last().expect("just pushed"))
    }

    /// Every checkpoint taken for one turn, newest last.
    pub fn for_turn(&self, turn_id: &str) -> Vec<&Checkpoint> {
        self.kept.iter().filter(|entry| entry.turn_id == turn_id).collect()
    }

    /// The turns that can be undone, newest first.
    pub fn turns(&self) -> Vec<String> {
        let mut seen: Vec<String> = Vec::new();
        for entry in self.kept.iter().rev() {
            if !seen.contains(&entry.turn_id) {
                seen.push(entry.turn_id.clone());
            }
        }
        seen
    }

    /// Puts one turn's files back, and reports what it could not restore.
    ///
    /// Restores in reverse order so a file touched twice in one turn ends up as
    /// it was before the *first* change, which is what "undo that turn" means.
    /// A file that had no copy because it did not exist is deleted again.
    pub fn restore(&mut self, turn_id: &str) -> Vec<String> {
        let mut failures = Vec::new();
        let entries: Vec<Checkpoint> = self
            .kept
            .iter()
            .filter(|entry| entry.turn_id == turn_id)
            .cloned()
            .collect();

        for entry in entries.iter().rev() {
            let outcome = match &entry.copy {
                Some(copy) => fs::copy(copy, &entry.original).map(|_| ()),
                None => match fs::remove_file(&entry.original) {
                    // Already gone is the state that was wanted.
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                    other => other,
                },
            };
            if let Err(error) = outcome {
                failures.push(format!("{}: {error}", entry.original.display()));
            }
        }

        failures
    }

    fn destination(&self, turn_id: &str, original: &Path, taken_at_ms: u128) -> PathBuf {
        let name = original
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "file".to_string());
        self.root.join(turn_id).join(format!("{taken_at_ms}-{name}"))
    }
}

#[cfg(test)]
#[path = "checkpoint_test.rs"]
mod checkpoint_test;
