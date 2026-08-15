//! Commands that no session mode is allowed to wave through.
//!
//! A spoken conversation runs unattended, and it has to: there is nobody looking
//! at the chat window to answer a confirmation, so a session that stops to ask
//! does not become safer, it becomes a tool call that times out and a model that
//! reports work it never did. That argument is sound, and it is why `yolo` sets
//! `auto_approve` for the whole tool set.
//!
//! It stops being sound at the point where being wrong cannot be undone. Writes
//! are confined to a workspace and checkpointed, so a bad edit costs a restore.
//! Wiping a disk, deleting somebody's documents, or piping a URL into a shell
//! costs the thing itself — and no amount of "it usually works" makes that an
//! acceptable trade to make on a user's behalf while they are in another room.
//!
//! So this is not a permission check with a default. It is a floor: these are
//! refused whatever the mode says, and the model is told to ask the person to
//! run it themselves. Everything else is unaffected, which is deliberate — a
//! guard that fires on ordinary work gets switched off, and then guards nothing.

use std::path::{Path, PathBuf};

use crate::confinement::Confinement;

/// Why a command was refused, in words a model can pass on.
pub struct Refusal(String);

impl Refusal {
    pub fn into_message(self) -> String {
        self.0
    }
}

/// Programs whose effect is the machine, not the workspace.
///
/// None of these has a safe form, so none of them is examined further.
const NEVER: &[&str] = &[
    "mkfs", "fdisk", "diskpart", "shutdown", "reboot", "halt", "poweroff", "chkdsk", "bcdedit", "vssadmin",
];

/// Programs that delete, and are examined against what they were pointed at.
const DELETES: &[&str] = &["rm", "rmdir", "del", "erase", "rd", "remove-item", "ri"];

/// Fetchers whose output, piped into a shell, is code nobody read.
const FETCHERS: &[&str] = &["curl", "wget", "iwr", "invoke-webrequest", "invoke-restmethod", "irm"];

/// Shells that will run whatever is handed to them on standard input.
const RUNNERS: &[&str] = &[
    "sh",
    "bash",
    "zsh",
    "dash",
    "ksh",
    "iex",
    "invoke-expression",
    "python",
    "node",
    "perl",
];

/// Splits a command line into the separate commands it will actually run.
///
/// `cd tmp && rm -rf ~` is two commands, and a check that reads only the first
/// sees `cd`. Pipes are kept as separators *and* remembered, because a pipe is
/// the whole of what makes `curl … | sh` different from `curl …`.
fn segments(command: &str) -> Vec<&str> {
    command
        .split([';', '\n', '&', '|'])
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .collect()
}

/// The program a segment invokes, lowercased and stripped of any path.
///
/// Returned with and without its extension, because `mkfs.ext4` and `mkfs` are
/// the same program as far as this is concerned, and matching only the whole
/// name is how `mkfs.ext4 /dev/sda1` walks past a list containing `mkfs`.
fn program(segment: &str) -> (String, String) {
    let first = segment.split_whitespace().next().unwrap_or_default();
    let bare = first.rsplit(['/', '\\']).next().unwrap_or(first).to_ascii_lowercase();
    let stem = bare.split('.').next().unwrap_or(&bare).to_string();
    (bare, stem)
}

/// Whether either spelling of a program is in a list.
fn listed(list: &[&str], program: &(String, String)) -> bool {
    list.contains(&program.0.as_str()) || list.contains(&program.1.as_str())
}

/// Whether an argument is a switch rather than something to act on.
///
/// `-rf` is a switch. `/s` is a switch on Windows. `/etc` is a path, and reading
/// it as a switch is how `rm -rf /` and `rm -rf /etc` passed the first version
/// of this check — the exact commands it exists to catch.
fn is_switch(argument: &str) -> bool {
    if argument.starts_with('-') {
        return true;
    }
    let Some(rest) = argument.strip_prefix('/') else {
        return false;
    };
    !rest.is_empty() && rest.len() <= 2 && rest.chars().all(|c| c.is_ascii_alphanumeric())
}

/// The arguments of a segment, without its flags.
fn operands(segment: &str) -> Vec<&str> {
    segment
        .split_whitespace()
        .skip(1)
        .filter(|argument| !is_switch(argument))
        .collect()
}

/// Whether a path names a whole disk, a home directory, or a user's own tree.
///
/// These are refused even inside a confinement, because a confinement can be set
/// to a home directory and "the workspace" is then everything the person owns.
fn is_somebodys_life(path: &Path) -> bool {
    let text = path.to_string_lossy().replace('\\', "/");
    let trimmed = text.trim_end_matches('/');

    // A root: "/", "C:", "C:/", or a UNC share.
    if trimmed.is_empty() || trimmed.starts_with("//") {
        return true;
    }
    if trimmed.len() <= 2 && trimmed.ends_with(':') {
        return true;
    }
    // "~" and anything directly under it, which is where documents live.
    let segments: Vec<&str> = trimmed.split('/').filter(|s| !s.is_empty()).collect();
    if segments.first() == Some(&"~") {
        return segments.len() <= 2;
    }
    // "C:/Users/someone" and one level below it.
    let lowered: Vec<String> = segments.iter().map(|s| s.to_ascii_lowercase()).collect();
    if let Some(index) = lowered.iter().position(|s| s == "users" || s == "home") {
        return segments.len() <= index + 3;
    }
    false
}

/// Resolves an argument the way the shell would, against the working directory.
fn against(cwd: &Path, argument: &str) -> PathBuf {
    let stripped = argument.trim_matches(|c| c == '"' || c == '\'');
    let path = Path::new(stripped);
    if path.is_absolute() || stripped.starts_with('~') {
        path.to_path_buf()
    } else {
        cwd.join(path)
    }
}

/// Reads a command and says what, if anything, must not be run unasked.
///
/// `confinement` is what the session was already told it may write to. A delete
/// aimed inside it is ordinary work — clearing `node_modules` is not a disaster,
/// and refusing it would be the kind of false alarm that gets a guard disabled.
/// A delete aimed outside it is somebody's files.
pub fn refuse(command: &str, cwd: &Path, confinement: &Confinement) -> Option<Refusal> {
    let mut piped_from_fetcher = false;

    for segment in segments(command) {
        let program = program(segment);

        if listed(NEVER, &program) {
            return Some(Refusal(format!(
                "Refused: `{}` changes the machine itself and cannot be undone. \
                 Ask the person to run it themselves if they want it.",
                program.0
            )));
        }

        if piped_from_fetcher && listed(RUNNERS, &program) {
            return Some(Refusal(
                "Refused: this pipes something downloaded straight into a shell, which runs code \
                 nobody has read. Download it to a file, show them what it does, and let them run it."
                    .to_string(),
            ));
        }
        piped_from_fetcher = listed(FETCHERS, &program) && command.contains('|');

        if listed(DELETES, &program) {
            for argument in operands(segment) {
                let target = against(cwd, argument);
                if is_somebodys_life(&target) {
                    return Some(Refusal(format!(
                        "Refused: `{argument}` is a whole drive or home directory. \
                         Deleting it cannot be undone, so it is not something to do without being asked."
                    )));
                }
                if !confinement.allows_write(&target) {
                    return Some(Refusal(format!(
                        "Refused: `{argument}` is outside the folder this session may change, \
                         and a delete leaves nothing to restore. Ask before touching it."
                    )));
                }
            }
        }
    }

    None
}

#[cfg(test)]
#[path = "irreversible_test.rs"]
mod irreversible_test;
