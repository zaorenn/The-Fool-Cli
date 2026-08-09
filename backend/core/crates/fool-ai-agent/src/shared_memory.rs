//! What the assistant has been told, given to every conversation.
//!
//! The two documents behind Settings → Memory (`user.md` and `agent.md`) were
//! read by exactly one caller: the spoken session, which assembled them into its
//! persona in the renderer. Everything else — a typed chat, a delegated task, a
//! conversation opened from a file — started with no idea who it was talking to,
//! so a name given out loud on Monday was gone the moment the same person typed
//! on Tuesday. Two assistants in one application, each remembering half.
//!
//! They are read here instead, at the one point every embedded session is built,
//! because a rule enforced in a factory cannot be forgotten by a new caller the
//! way a rule written in a document can.
//!
//! What is *not* here is a second store. This reads the same key the settings
//! page writes, so what the user sees in that page is the whole of what any
//! agent knows about them — and a memory the user cannot read is one they cannot
//! correct.

use std::sync::Arc;

use fool_db::IClientPreferenceRepository;
use serde::Deserialize;

/// Where the memory lives. The renderer's `MEMORY_CONFIG_KEY`, spelled once more
/// on this side; the two must agree or the memory silently reads as empty.
const MEMORY_KEY: &str = "fool.voice.memory";

/// The stored shape. Anything else in the record is ignored — `introduced` is a
/// fact about the application, not about the person, and has no business in a
/// prompt.
#[derive(Deserialize, Default)]
struct StoredMemory {
    #[serde(default)]
    user: String,
    #[serde(default)]
    agent: String,
}

/// Reads the memory, or nothing at all.
///
/// Every failure — no repository, no row, unparseable JSON, a database that will
/// not answer — comes back as `None` rather than as an error. A conversation
/// that cannot start because the memory could not be read is a far worse outcome
/// than one that starts without it, and the user's own words are the thing being
/// enriched with, not depended on.
pub async fn read_shared_memory(repo: Option<&Arc<dyn IClientPreferenceRepository>>, user_id: &str) -> Option<String> {
    let rows = repo?.get_by_keys(user_id, &[MEMORY_KEY]).await.ok()?;
    let raw = rows.into_iter().find(|row| row.key == MEMORY_KEY)?.value;
    let stored: StoredMemory = serde_json::from_str(&raw).ok()?;
    render(&stored.user, &stored.agent)
}

/// The block a model is given, or `None` when there is nothing worth saying.
///
/// Deliberately the same wording as the renderer's `buildAgentBriefing`: the
/// spoken assistant, a delegated agent and a typed chat are meant to read the
/// memory the same way, and two descriptions of one thing drift apart the first
/// time either is edited.
fn render(user: &str, agent: &str) -> Option<String> {
    let documents: Vec<&str> = [user.trim(), agent.trim()]
        .into_iter()
        .filter(|doc| !doc.is_empty())
        .collect();
    if documents.is_empty() {
        return None;
    }

    let mut block = String::from(
        "<user-memory>\n\
         What The Fool knows about the person you are working for. Use it to read what they ask the \
         way they meant it — their own words for places, people and projects are in here, and a word \
         like \"desktop\" means whatever this says it means. Follow anything under \"Skills you taught \
         me\" as a standing instruction. Do not recite this block back to them and do not mention that \
         you have it.\n",
    );
    for document in documents {
        block.push('\n');
        block.push_str(document);
        block.push('\n');
    }
    block.push_str("</user-memory>");
    Some(block)
}

/// Puts the memory in front of whatever else the session was going to say.
///
/// First, because it is context for reading the rest: a rule that mentions "the
/// project" is ambiguous until the memory has said which one.
pub fn prepend(memory: Option<String>, prompt: Option<String>) -> Option<String> {
    match (memory, prompt) {
        (Some(memory), Some(prompt)) => Some(format!("{memory}\n\n{prompt}")),
        (Some(memory), None) => Some(memory),
        (None, prompt) => prompt,
    }
}

#[cfg(test)]
#[path = "shared_memory_test.rs"]
mod shared_memory_test;
