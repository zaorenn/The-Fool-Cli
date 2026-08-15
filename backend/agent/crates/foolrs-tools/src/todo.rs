//! Keeping the plan where the model can see it, one turn to the next.
//!
//! A long task is not lost all at once. It is lost a step at a time: the fourth
//! item is done, the third turn recaps the first two, and by the seventh the
//! sixth has quietly stopped being mentioned. Nothing errors, so nothing is
//! caught, and the work ends up reported as finished with two pieces missing.
//!
//! Every other tool here does something to the world. This one does something
//! to the agent: it is the place the plan is written down, so that "what is
//! left" is read rather than remembered. The list comes back in full on every
//! call, which is the point — a tool that returned only "saved" would leave the
//! model reconstructing the list from a transcript, which is the failure it was
//! added to prevent.
//!
//! Three things are deliberate.
//!
//! **The whole list is sent every time.** Not a patch. A model editing item
//! three by index gets the index wrong often enough to matter, and a list that
//! silently reorders is worse than no list. Sending it whole means the state is
//! always exactly what was last written.
//!
//! **Exactly one item may be in progress.** More than one is not a plan, it is
//! a wish; the constraint is enforced rather than advised, because a model told
//! "only one" in prose will still mark three when it is going quickly.
//!
//! **It is `ToolCategory::Info`.** Nothing outside the agent changes, so a
//! permission prompt for it would be a prompt for thinking out loud.

use std::sync::Mutex;

use async_trait::async_trait;
use serde_json::{Value, json};

use foolrs_protocol::events::ToolCategory;
use foolrs_types::tool::{JsonSchema, ToolResult};

use crate::Tool;

/// The most items one list may hold.
///
/// A plan longer than this is not a plan, it is the work itself written out,
/// and it costs a slice of every future turn's context to carry.
const MAX_ITEMS: usize = 40;

/// The longest a single item may be.
const MAX_ITEM_LENGTH: usize = 500;

/// Where an item has got to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TodoStatus {
    Pending,
    InProgress,
    Completed,
}

impl TodoStatus {
    fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "pending" | "todo" | "" => Some(Self::Pending),
            "in_progress" | "in-progress" | "active" | "doing" => Some(Self::InProgress),
            "completed" | "done" | "complete" => Some(Self::Completed),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
        }
    }

    /// The box drawn beside the item when the list is read back.
    fn mark(self) -> &'static str {
        match self {
            Self::Pending => "[ ]",
            Self::InProgress => "[~]",
            Self::Completed => "[x]",
        }
    }
}

#[derive(Debug, Clone)]
pub struct TodoItem {
    pub content: String,
    pub status: TodoStatus,
}

/// The list, rendered for reading back.
///
/// Deliberately plain text rather than JSON. This goes back into a context
/// window on the next turn, and a model reads a checklist more reliably than it
/// reads an array of objects describing one.
fn render(items: &[TodoItem]) -> String {
    if items.is_empty() {
        return "The list is empty.".to_string();
    }

    let done = items.iter().filter(|item| item.status == TodoStatus::Completed).count();
    let mut out = format!("{done}/{} done\n", items.len());
    for item in items {
        out.push_str(&format!("{} {}\n", item.status.mark(), item.content));
    }

    match items.iter().find(|item| item.status == TodoStatus::InProgress) {
        Some(current) => out.push_str(&format!("\nOn now: {}", current.content)),
        None if done < items.len() => {
            // Said rather than left for the model to notice. A list with
            // nothing in progress and work outstanding is the state it lands in
            // after finishing an item and forgetting to pick up the next.
            out.push_str("\nNothing is marked in progress. Start the next item.");
        }
        None => out.push_str("\nEverything on the list is done."),
    }

    out
}

/// Reads the items out of whatever the model actually sent.
///
/// Generous about shape and strict about contents, for the reason the rest of
/// this codebase is: a small local model sends a bare string where the schema
/// says array, or `done` where it says `completed`, and refusing the call means
/// the plan is silently not kept.
fn parse_items(raw: &Value) -> Result<Vec<TodoItem>, String> {
    let Some(entries) = raw.as_array() else {
        return Err("`todos` must be an array of items.".to_string());
    };

    if entries.len() > MAX_ITEMS {
        return Err(format!(
            "A list of {} is too long to carry on every turn; {MAX_ITEMS} is the most. Keep the steps and drop the \
             detail.",
            entries.len()
        ));
    }

    let mut items = Vec::with_capacity(entries.len());
    for entry in entries {
        // A plain string is a pending item. Models send this often enough that
        // refusing it would reject a perfectly clear plan on a technicality.
        let (content, status_raw) = match entry {
            Value::String(text) => (text.clone(), String::new()),
            Value::Object(_) => (
                entry["content"]
                    .as_str()
                    .or_else(|| entry["task"].as_str())
                    .unwrap_or("")
                    .to_string(),
                entry["status"].as_str().unwrap_or("").to_string(),
            ),
            _ => return Err("Each item must be a string, or an object with `content` and `status`.".to_string()),
        };

        let content = content.trim().to_string();
        if content.is_empty() {
            return Err("An item with no content cannot be tracked.".to_string());
        }
        if content.len() > MAX_ITEM_LENGTH {
            return Err(format!("An item longer than {MAX_ITEM_LENGTH} characters is a task, not a step."));
        }

        let Some(status) = TodoStatus::parse(&status_raw) else {
            return Err(format!(
                "`status` must be pending, in_progress or completed; got \"{status_raw}\"."
            ));
        };

        items.push(TodoItem { content, status });
    }

    let in_progress = items.iter().filter(|item| item.status == TodoStatus::InProgress).count();
    if in_progress > 1 {
        // Enforced rather than advised. Told "only one" in prose, a model going
        // quickly still marks three, and three things in progress is the state
        // where none of them is.
        return Err(format!(
            "{in_progress} items are marked in progress. Exactly one thing is being worked on at a time — mark the \
             rest pending."
        ));
    }

    Ok(items)
}

/// The list for this session.
///
/// Held in the tool rather than on disk: a plan is about the work in hand, and
/// one restored from a previous session would be a stale list the model treats
/// as current. What is worth keeping past the end of a session goes to
/// `Remember`, which is the tool for that.
pub struct TodoTool {
    items: Mutex<Vec<TodoItem>>,
}

impl TodoTool {
    pub fn new() -> Self {
        Self {
            items: Mutex::new(Vec::new()),
        }
    }

    /// What is on the list now, for tests and for anything that displays it.
    pub fn items(&self) -> Vec<TodoItem> {
        self.items.lock().map(|items| items.clone()).unwrap_or_default()
    }
}

impl Default for TodoTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for TodoTool {
    fn name(&self) -> &str {
        "TodoWrite"
    }

    fn description(&self) -> &str {
        "Keeps the plan for the task in hand, so what is left is read rather than remembered.\n\n\
         Usage:\n\
         - Write the list as soon as a request has more than a couple of steps, then update it as you go. A long job is not lost all at once — it is lost one forgotten step at a time.\n\
         - Send the **whole list** every time, not a change to it. What you send replaces what was there.\n\
         - Mark exactly one item `in_progress`, the one you are actually doing. Mark it `completed` the moment it is done, not in a batch at the end.\n\
         - The full list comes back on every call. Read it rather than reconstructing it from the conversation.\n\
         - Do not use it for a single obvious step, and do not read the list out to the user unless they asked what is left."
    }

    fn input_schema(&self) -> JsonSchema {
        json!({
            "type": "object",
            "properties": {
                "todos": {
                    "type": "array",
                    "description": "The whole list, in the order the work happens. This replaces the previous list entirely.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "content": {
                                "type": "string",
                                "description": "The step, as something to do: 'add the failing test', not 'tests'."
                            },
                            "status": {
                                "type": "string",
                                "enum": ["pending", "in_progress", "completed"],
                                "description": "Exactly one item may be in_progress at a time."
                            }
                        },
                        "required": ["content", "status"]
                    }
                }
            },
            "required": ["todos"]
        })
    }

    fn category(&self) -> ToolCategory {
        // Nothing outside the agent changes. Asking permission to write down
        // what you intend to do would be asking permission to think.
        ToolCategory::Info
    }

    fn is_concurrency_safe(&self, _input: &Value) -> bool {
        false
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let parsed = match parse_items(&input["todos"]) {
            Ok(items) => items,
            Err(error) => {
                return ToolResult {
                    content: error,
                    is_error: true,
                };
            }
        };

        let rendered = render(&parsed);
        match self.items.lock() {
            Ok(mut items) => *items = parsed,
            Err(_) => {
                return ToolResult {
                    content: "The list could not be written.".to_string(),
                    is_error: true,
                };
            }
        }

        ToolResult {
            content: rendered,
            is_error: false,
        }
    }
}

#[cfg(test)]
#[path = "todo_test.rs"]
mod todo_test;

/// The statuses, as the wire spells them, for anything rendering the list.
pub fn status_names() -> [&'static str; 3] {
    [
        TodoStatus::Pending.as_str(),
        TodoStatus::InProgress.as_str(),
        TodoStatus::Completed.as_str(),
    ]
}
