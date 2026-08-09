//! A sub-agent's work, forwarded with its name on it.
//!
//! Children ran with a [`NullSink`](crate::output::null_sink::NullSink):
//! everything they said was discarded and only the final text came back, so a
//! user watching a request that had been split into five could see that
//! something was happening and nothing about what. The comparison this project
//! is judged against shows each child's conversation separately, and this was
//! recorded as a real capability gap.
//!
//! Two decisions make the difference between forwarding and noise.
//!
//! **Every line is labelled.** Five children streaming into one transcript
//! without saying who is speaking is worse than silence, because a person
//! reading it believes it is one train of thought.
//!
//! **Text deltas stay silent.** A child's prose is already returned to the
//! parent as its result, and forwarding it token by token would have five
//! answers being written over the top of the parent's own. What is forwarded is
//! what a person actually wants while waiting: which tools ran, and how they
//! went.

use std::sync::Arc;

use crate::output::sink::OutputSink;

/// Wraps a sink so everything from one child is attributed to it.
pub struct LabelledSink {
    inner: Arc<dyn OutputSink>,
    name: String,
}

impl LabelledSink {
    pub fn new(inner: Arc<dyn OutputSink>, name: impl Into<String>) -> Self {
        Self {
            inner,
            name: name.into(),
        }
    }

    fn tag(&self, text: &str) -> String {
        format!("[{}] {text}", self.name)
    }
}

impl OutputSink for LabelledSink {
    fn emit_text_delta(&self, _text: &str, _msg_id: &str) {
        // Deliberately dropped. The child's answer comes back to the parent as
        // its result; streaming it here as well would put five replies on top
        // of the parent's own, interleaved, with no way to tell them apart.
    }

    fn emit_thinking(&self, _text: &str, _msg_id: &str) {
        // Same reason, and worse: reasoning is the longest thing a child
        // produces and the least useful to somebody watching progress.
    }

    fn emit_tool_call(&self, tool_use_id: &str, name: &str, input: &str) {
        self.inner.emit_tool_call(tool_use_id, &self.tag(name), input);
    }

    fn emit_tool_result(&self, tool_use_id: &str, name: &str, is_error: bool, content: &str) {
        self.inner
            .emit_tool_result(tool_use_id, &self.tag(name), is_error, content);
    }

    fn emit_stream_start(&self, _msg_id: &str) {
        // A child does not start a message in the parent's transcript; it would
        // read as the assistant beginning a new answer.
    }

    fn emit_stream_end(
        &self,
        _msg_id: &str,
        _turns: usize,
        _input_tokens: u64,
        _output_tokens: u64,
        _cache_creation_tokens: u64,
        _cache_read_tokens: u64,
    ) {
    }

    fn emit_error(&self, msg: &str) {
        // Forwarded, and named. A child that failed is the thing a person most
        // needs to see, and an unattributed failure in a run of five is a
        // failure nobody can act on.
        self.inner.emit_error(&self.tag(msg));
    }

    fn emit_info(&self, _msg: &str) {
        // Dropped. What comes through here is telemetry — cache hit rates,
        // compaction notices — emitted once per turn per agent. Useful from one
        // parent, a flood from five children, and none of it is what somebody
        // waiting wants to read. The spawner announces a child starting and
        // finishing itself, which is the part worth saying.
    }
}

#[cfg(test)]
#[path = "labelled_sink_test.rs"]
mod labelled_sink_test;
