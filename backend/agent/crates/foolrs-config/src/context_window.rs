//! How much the model can actually read.
//!
//! Compaction is configured with a `context_window` that defaults to 200,000
//! tokens, and nothing in this application ever set it from the model in front
//! of it. On anything smaller — which is every local model this product exists
//! to run — the threshold was never reached, automatic compaction never fired,
//! and the conversation grew until the model overran its window and failed. The
//! feature was present, configured, tested, and inert.
//!
//! **The two errors are not symmetrical, and that decides the whole design.**
//! Guessing too high means no compaction and a conversation that dies. Guessing
//! too low means compacting earlier than necessary: some context lost, some
//! tokens spent, nothing broken. So every unknown is treated as small.

/// What is assumed when nothing is known about the model.
///
/// Deliberately pessimistic. A model this cannot name is far more likely to be
/// something loaded locally on a consumer card than a frontier model with a
/// enormous window, and being wrong in the other direction is the failure this
/// module exists to remove.
pub const UNKNOWN_LOCAL_WINDOW: usize = 8_192;

/// What a hosted frontier model is assumed to have when it is not recognised.
///
/// Higher because these are reached over somebody's API and the host enforces
/// its own limit anyway: overrunning is answered with an error rather than
/// silence, and the request is not the thing holding a person's machine.
pub const UNKNOWN_HOSTED_WINDOW: usize = 128_000;

/// Families this can name, longest match first so `gpt-4.1` beats `gpt-4`.
const KNOWN: &[(&str, usize)] = &[
    // Anthropic
    ("claude-3-5", 200_000),
    ("claude-3-7", 200_000),
    ("claude-opus", 200_000),
    ("claude-sonnet", 200_000),
    ("claude-haiku", 200_000),
    ("claude", 200_000),
    // OpenAI
    ("gpt-4.1", 1_000_000),
    ("gpt-4o", 128_000),
    ("gpt-4", 128_000),
    ("o1", 200_000),
    ("o3", 200_000),
    // Google
    ("gemini-1.5", 1_000_000),
    ("gemini", 1_000_000),
    ("gemma-4", 128_000),
    ("gemma-3", 128_000),
    ("gemma", 8_192),
    // Open weights commonly run locally
    ("qwen3", 32_768),
    ("qwen2.5", 32_768),
    ("qwen", 32_768),
    ("llama-3", 128_000),
    ("llama", 8_192),
    ("mistral", 32_768),
    ("mixtral", 32_768),
    ("phi-4", 16_384),
    ("phi", 4_096),
    ("deepseek", 64_000),
];

/// The window to compact against, for this model.
///
/// `configured` wins when somebody has set one: a person who knows what they
/// loaded, and with what settings, knows better than any table. `local` selects
/// which assumption applies when the name means nothing here.
pub fn context_window_for(model: &str, local: bool, configured: Option<usize>) -> usize {
    if let Some(explicit) = configured.filter(|value| *value > 0) {
        return explicit;
    }

    let name = model.to_ascii_lowercase();
    let mut best: Option<(usize, usize)> = None;
    for (family, window) in KNOWN {
        if name.contains(family) {
            let length = family.len();
            if best.is_none_or(|(known, _)| length > known) {
                best = Some((length, *window));
            }
        }
    }

    match best {
        Some((_, window)) => window,
        None if local => UNKNOWN_LOCAL_WINDOW,
        None => UNKNOWN_HOSTED_WINDOW,
    }
}

/// Whether a base URL points at something on this machine or this network.
///
/// A model served from loopback is one somebody loaded themselves, on hardware
/// they own, and it is the case where guessing high is fatal.
pub fn is_local_endpoint(base_url: &str) -> bool {
    let url = base_url.to_ascii_lowercase();
    url.contains("//localhost")
        || url.contains("//127.0.0.1")
        || url.contains("//[::1]")
        || url.contains("//0.0.0.0")
        || url.contains("//192.168.")
        || url.contains("//10.")
        || url.contains("//host.docker.internal")
}

#[cfg(test)]
#[path = "context_window_test.rs"]
mod context_window_test;
