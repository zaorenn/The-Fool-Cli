//! Asking a local server how much its model can actually read.
//!
//! The compaction threshold needs the model's context window, and for a model
//! served from this machine the window is not a property of the model at all —
//! it is whatever was chosen when it was loaded. A name table cannot know that,
//! and the provider record only carries the number when somebody typed it,
//! which nothing in the interface ever asks them to do.
//!
//! LM Studio does know, and says so on its native REST API. Ask it. When the
//! answer does not come — a different server, an older build, nothing
//! listening — the caller keeps whatever it was going to use anyway, so this is
//! an improvement on a guess and never a new way to fail.

use serde::Deserialize;
use std::time::Duration;

/// How long to wait before giving up and letting the guess stand.
///
/// Short on purpose. This runs while somebody waits for a conversation to open,
/// against a server on loopback that answers in single-digit milliseconds when
/// it is there at all. A slow answer here is a server that is not going to
/// answer, and the cost of not waiting is one guessed number.
const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);

/// One entry of LM Studio's `/api/v0/models`.
///
/// Only the three fields that matter are named; the payload carries much more
/// and is allowed to change without breaking this.
#[derive(Debug, Deserialize)]
struct NativeModel {
    id: String,
    /// The window it was loaded with, present only while it is loaded.
    #[serde(default)]
    loaded_context_length: Option<u64>,
    /// The largest window this model supports.
    ///
    /// Read but deliberately unused: see `window_from_listing` for why it is
    /// not an acceptable substitute when the model is not loaded.
    #[serde(default)]
    #[allow(dead_code)]
    max_context_length: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct NativeModelList {
    #[serde(default)]
    data: Vec<NativeModel>,
}

/// The native API address that corresponds to an OpenAI-compatible base URL.
///
/// LM Studio serves the OpenAI-compatible surface at `/v1` and its own richer
/// one at `/api/v0`, on the same host and port. Only `/v1` is stored, because
/// that is the one a user pastes.
pub(crate) fn native_models_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    let root = trimmed.strip_suffix("/v1").unwrap_or(trimmed);
    format!("{root}/api/v0/models")
}

/// The window for `model_id`, from a native model listing.
///
/// **Only what the model was actually loaded with counts.** The listing also
/// carries `max_context_length`, the largest window the weights support, and
/// that number is worse than no answer: `qwen/qwen3.5-9b` reports 262,144
/// against the 64,256 it was loaded with, and compacting against the former
/// means never compacting at all and letting the conversation run past the
/// window it really has. Which is the failure the whole module was written to
/// prevent, arrived at from the other side.
///
/// A model that is not loaded therefore yields nothing, and the caller keeps
/// its pessimistic guess from the model's name. That is right rather than
/// merely safe: what window it *will* be loaded with is not yet decided, and
/// the supported maximum is no evidence about it.
///
/// Matching is exact first, then by suffix, because the id stored against a
/// provider is sometimes qualified with a publisher (`qwen/qwen3.5-9b`) where
/// the server lists it bare, or the other way round.
fn window_from_listing(body: &str, model_id: &str) -> Option<usize> {
    let listing: NativeModelList = serde_json::from_str(body).ok()?;
    let wanted = model_id.to_ascii_lowercase();

    let matched = listing
        .data
        .iter()
        .find(|entry| entry.id.to_ascii_lowercase() == wanted)
        .or_else(|| {
            listing.data.iter().find(|entry| {
                let id = entry.id.to_ascii_lowercase();
                id.ends_with(&wanted) || wanted.ends_with(&id)
            })
        })?;

    let window = matched.loaded_context_length?;
    usize::try_from(window).ok().filter(|value| *value > 0)
}

/// Ask the server in front of us, and take no for an answer.
pub(crate) async fn probe_context_window(base_url: &str, model_id: &str) -> Option<usize> {
    let url = native_models_url(base_url);
    let client = reqwest::Client::builder().timeout(PROBE_TIMEOUT).build().ok()?;
    let body = client.get(&url).send().await.ok()?.text().await.ok()?;
    window_from_listing(&body, model_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_the_native_url_from_an_openai_base_url() {
        assert_eq!(
            native_models_url("http://127.0.0.1:1234/v1"),
            "http://127.0.0.1:1234/api/v0/models"
        );
    }

    #[test]
    fn tolerates_a_trailing_slash_and_a_missing_v1() {
        assert_eq!(
            native_models_url("http://127.0.0.1:1234/v1/"),
            "http://127.0.0.1:1234/api/v0/models"
        );
        assert_eq!(
            native_models_url("http://localhost:1234"),
            "http://localhost:1234/api/v0/models"
        );
    }

    const LISTING: &str = r#"{
        "data": [
            { "id": "phi-3.5-mini-instruct", "max_context_length": 16384 },
            { "id": "qwen/qwen3.5-9b", "loaded_context_length": 65536, "max_context_length": 131072 }
        ]
    }"#;

    /// The reported failure: 64k chosen in LM Studio, 32,768 guessed from the name.
    #[test]
    fn reads_the_window_the_model_was_loaded_with() {
        assert_eq!(window_from_listing(LISTING, "qwen/qwen3.5-9b"), Some(65536));
    }

    /// The regression this file was changed for.
    ///
    /// A model that is not loaded reports only what it could support. Taking
    /// that number set the window to 262,144 against a model loaded at 64,256,
    /// which stops compaction firing at all.
    #[test]
    fn a_model_that_is_not_loaded_yields_nothing_rather_than_its_maximum() {
        assert_eq!(window_from_listing(LISTING, "phi-3.5-mini-instruct"), None);
    }

    /// The loaded window is the one that will be enforced, and the supported
    /// maximum is four times larger here.
    #[test]
    fn takes_the_loaded_window_and_never_the_supported_maximum() {
        assert_eq!(window_from_listing(LISTING, "qwen/qwen3.5-9b"), Some(65536));
        let bigger = r#"{ "data": [ { "id": "m", "loaded_context_length": 8192, "max_context_length": 262144 } ] }"#;
        assert_eq!(window_from_listing(bigger, "m"), Some(8192));
    }

    #[test]
    fn matches_a_publisher_qualified_id_against_a_bare_one() {
        let bare = r#"{ "data": [ { "id": "qwen3.5-9b", "loaded_context_length": 65536 } ] }"#;
        assert_eq!(window_from_listing(bare, "qwen/qwen3.5-9b"), Some(65536));
    }

    #[test]
    fn an_unknown_model_yields_nothing_rather_than_a_wrong_number() {
        assert_eq!(window_from_listing(LISTING, "llama-3-70b"), None);
    }

    #[test]
    fn a_body_that_is_not_a_listing_yields_nothing() {
        assert_eq!(window_from_listing("<html>not found</html>", "qwen/qwen3.5-9b"), None);
        assert_eq!(window_from_listing("{}", "qwen/qwen3.5-9b"), None);
    }

    #[test]
    fn a_zero_window_is_not_an_answer() {
        let zero = r#"{ "data": [ { "id": "m", "loaded_context_length": 0 } ] }"#;
        assert_eq!(window_from_listing(zero, "m"), None);
    }
}
