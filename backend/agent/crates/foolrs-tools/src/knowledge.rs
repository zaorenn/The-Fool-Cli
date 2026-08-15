//! Writing something down so the next session already knows it.
//!
//! The memory system was only half connected. `foolrs-memory` can read, write,
//! scan and delete; the agent's context builder reads it on every turn — and
//! `write_memory` was called from nowhere but tests. So the agent started each
//! session knowing whatever a human had typed into those files, learned things
//! over the course of the work, and forgot all of it.
//!
//! That is the half this closes. What is worth keeping is not a transcript: it
//! is the shape of the project that took an hour to work out, the command that
//! turned out to be the one that works, the correction the user should not have
//! to give twice.
//!
//! Two things are deliberate about the design.
//!
//! **The name is a key, not a title.** Writing twice under one name replaces
//! rather than accumulates, so a fact that changes is corrected instead of
//! contradicted. A memory directory holding both "the tests are run with bun"
//! and "the tests are run with npm" is worse than one holding neither.
//!
//! **Recall reads one entry, not all of them.** The manifest of names and
//! descriptions is already in the prompt; this is for opening the one that
//! turned out to matter. Returning everything would put an entire memory
//! directory into a context window to answer one question.

use std::path::PathBuf;

use async_trait::async_trait;
use serde_json::{Value, json};

use foolrs_memory::store::{read_memory, scan_memory_files, write_memory};
use foolrs_memory::types::{MemoryEntry, MemoryType};
use foolrs_protocol::events::ToolCategory;
use foolrs_types::tool::{JsonSchema, ToolResult};

use crate::Tool;

/// The longest a single entry may be.
///
/// Memory is read on every turn of every future session, so an entry is paid
/// for many times over. Something that needs more room than this is a file in
/// the project, and what belongs here is the sentence saying where it is.
const MAX_CONTENT: usize = 4_000;

/// What kind of thing is being remembered.
///
/// The four the memory system already models, described in terms of the
/// question each answers rather than by their names — a model choosing between
/// "user" and "project" from those words alone picks wrong about half the time.
fn kind_of(raw: &str) -> Option<MemoryType> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "user" | "person" | "preference" => Some(MemoryType::User),
        "feedback" | "correction" | "lesson" => Some(MemoryType::Feedback),
        "project" | "architecture" | "procedure" | "snippet" => Some(MemoryType::Project),
        "reference" | "link" | "resource" => Some(MemoryType::Reference),
        _ => None,
    }
}

/// A name reduced to something that can be a filename and a key.
///
/// Lower-cased and hyphenated so that "Test Command" and "test-command" are the
/// same memory rather than two that disagree.
pub fn memory_key(name: &str) -> String {
    let mut key = String::with_capacity(name.len());
    let mut last_was_dash = true;

    for character in name.trim().chars() {
        if character.is_alphanumeric() {
            for lowered in character.to_lowercase() {
                key.push(lowered);
            }
            last_was_dash = false;
        } else if !last_was_dash {
            key.push('-');
            last_was_dash = true;
        }
    }

    key.trim_end_matches('-').to_string()
}

pub struct RememberTool {
    memory_dir: PathBuf,
}

impl RememberTool {
    pub fn new(memory_dir: PathBuf) -> Self {
        Self { memory_dir }
    }
}

#[async_trait]
impl Tool for RememberTool {
    fn name(&self) -> &str {
        "Remember"
    }

    fn description(&self) -> &str {
        "Writes something down so the next session starts already knowing it.\n\n\
         Usage:\n\
         - Use it for what you worked out and would be sorry to work out again: how this project is laid out, which command is the one that actually works, a correction the user should not have to give twice, the address of something you had to hunt for.\n\
         - `name` is a key, not a title. Writing twice under the same name replaces it, so a fact that has changed gets corrected rather than contradicted.\n\
         - `description` is what decides whether this is ever read again — it is the only part that goes into a future prompt. Write it as the question it answers.\n\
         - Do not record what the code already says, what a transcript would show, or anything that is only true for this conversation.\n\
         - Say nothing to the user about having done this unless they asked."
    }

    fn input_schema(&self) -> JsonSchema {
        json!({
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "A short key, in a few words. Writing again under the same key replaces what is there."
                },
                "kind": {
                    "type": "string",
                    "enum": ["user", "feedback", "project", "reference"],
                    "description": "'user' is who they are and how they like things; 'feedback' is a correction they gave you; 'project' is how this work or codebase is; 'reference' is where something lives."
                },
                "description": {
                    "type": "string",
                    "description": "One line, written as the question this answers. It is the only part a future session sees before deciding whether to read the rest."
                },
                "content": {
                    "type": "string",
                    "description": "The thing itself, in as few words as carry it. Write it as something to act on, not as a note about what happened."
                }
            },
            "required": ["name", "kind", "description", "content"]
        })
    }

    fn category(&self) -> ToolCategory {
        // It writes a file. The layer that decides what needs permission reads
        // this field, and a tool that creates something on disk must be seen as
        // one that does.
        ToolCategory::Edit
    }

    fn is_concurrency_safe(&self, _input: &Value) -> bool {
        false
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let field = |key: &str| input[key].as_str().map(str::trim).unwrap_or("").to_string();

        let name = field("name");
        let key = memory_key(&name);
        if key.is_empty() {
            return ToolResult {
                content: "Missing required parameter: name".to_string(),
                is_error: true,
            };
        }

        let Some(kind) = kind_of(&field("kind")) else {
            return ToolResult {
                content: "`kind` must be one of: user, feedback, project, reference".to_string(),
                is_error: true,
            };
        };

        let description = field("description");
        if description.is_empty() {
            // Refused rather than defaulted. The description is the only part a
            // future session reads before deciding whether to open the entry, so
            // one without it is a memory that will never be recalled — written,
            // and as good as lost.
            return ToolResult {
                content: "`description` is required: it is the only part a future session sees, so an entry without \
                          one is never recalled."
                    .to_string(),
                is_error: true,
            };
        }

        let content = field("content");
        if content.is_empty() {
            return ToolResult {
                content: "Missing required parameter: content".to_string(),
                is_error: true,
            };
        }
        if content.len() > MAX_CONTENT {
            return ToolResult {
                content: format!(
                    "That is {} characters, over the {MAX_CONTENT} a memory may hold. Memory is read on every turn of \
                     every future session — keep the sentence and put the rest in a file.",
                    content.len()
                ),
                is_error: true,
            };
        }

        let entry = MemoryEntry::build(key.clone(), description, kind, content);
        match write_memory(&self.memory_dir, &entry) {
            Ok(path) => ToolResult {
                content: format!("Remembered as \"{key}\" ({path}).", path = path.display()),
                is_error: false,
            },
            Err(error) => ToolResult {
                content: format!("That could not be written down: {error}"),
                is_error: true,
            },
        }
    }
}

pub struct RecallTool {
    memory_dir: PathBuf,
}

impl RecallTool {
    pub fn new(memory_dir: PathBuf) -> Self {
        Self { memory_dir }
    }
}

#[async_trait]
impl Tool for RecallTool {
    fn name(&self) -> &str {
        "Recall"
    }

    fn description(&self) -> &str {
        "Reads one thing written down in an earlier session, in full.\n\n\
         Usage:\n\
         - The names and one-line descriptions of what is remembered are already in your context. This opens one of them.\n\
         - Call it with no name to list what is there.\n\
         - A name that matches nothing says so; it does not mean the thing is untrue, only that nobody wrote it down."
    }

    fn input_schema(&self) -> JsonSchema {
        json!({
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "The key it was remembered under. Leave out to list everything that is remembered."
                }
            },
            "required": []
        })
    }

    fn category(&self) -> ToolCategory {
        ToolCategory::Info
    }

    fn is_concurrency_safe(&self, _input: &Value) -> bool {
        true
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let headers = match scan_memory_files(&self.memory_dir) {
            Ok(headers) => headers,
            Err(error) => {
                return ToolResult {
                    content: format!("Nothing could be read from the memory directory: {error}"),
                    is_error: true,
                };
            }
        };

        let wanted = input["name"].as_str().map(memory_key).unwrap_or_default();

        if wanted.is_empty() {
            if headers.is_empty() {
                return ToolResult {
                    content: "Nothing has been remembered yet.".to_string(),
                    is_error: false,
                };
            }
            let listed = headers
                .iter()
                .map(|header| {
                    format!(
                        "- {} — {}",
                        header.filename.trim_end_matches(".md"),
                        header.description.as_deref().unwrap_or("(no description)")
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");
            return ToolResult {
                content: format!("Remembered so far:\n{listed}"),
                is_error: false,
            };
        }

        // `write_memory` names the file `<type>_<name>.md` and sanitises the
        // name by turning every non-alphanumeric character into an underscore.
        // So the key `test-command` is on disk as `project_test_command.md`,
        // and matching the key as written finds nothing — which reads exactly
        // like "nobody wrote that down" and is not the same thing at all.
        //
        // The prefix is stripped and the rest compared exactly rather than by
        // suffix: `command` must not open `test_command`.
        let wanted_on_disk = wanted.replace('-', "_");
        let found = headers.iter().find(|header| {
            let stem = header.filename.trim_end_matches(".md");
            stem.split_once('_').is_some_and(|(_, name)| name == wanted_on_disk)
        });

        let Some(header) = found else {
            return ToolResult {
                content: format!(
                    "Nothing is remembered under \"{wanted}\". That means nobody wrote it down, not that it is untrue."
                ),
                is_error: false,
            };
        };

        match read_memory(&header.file_path) {
            Ok(entry) => ToolResult {
                content: entry.content,
                is_error: false,
            },
            Err(error) => ToolResult {
                content: format!("\"{wanted}\" is there but could not be read: {error}"),
                is_error: true,
            },
        }
    }
}

#[cfg(test)]
#[path = "knowledge_test.rs"]
mod knowledge_test;
