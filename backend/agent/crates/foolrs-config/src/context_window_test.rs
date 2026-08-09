use super::*;

#[test]
fn an_explicit_setting_beats_every_guess() {
    // Somebody who knows what they loaded, and with what settings, knows better
    // than any table in this file.
    assert_eq!(context_window_for("google/gemma-4-e4b", true, Some(4_096)), 4_096);
}

#[test]
fn a_zero_setting_is_not_a_setting() {
    assert_eq!(context_window_for("google/gemma-4-e4b", true, Some(0)), 128_000);
}

#[test]
fn a_model_it_can_name_gets_that_window() {
    assert_eq!(context_window_for("claude-sonnet-5", false, None), 200_000);
    assert_eq!(context_window_for("google/gemma-4-e4b", true, None), 128_000);
    assert_eq!(context_window_for("qwen/qwen3.6-35b-a3b", true, None), 32_768);
}

#[test]
fn the_longest_name_wins() {
    // `gemma-4` must beat `gemma`, or every Gemma would be treated as the
    // smallest one and compacted far too eagerly.
    assert_eq!(context_window_for("gemma-4-e4b", true, None), 128_000);
    assert_eq!(context_window_for("gemma-2b", true, None), 8_192);
}

#[test]
fn something_unknown_and_local_is_assumed_small() {
    // The two errors are not symmetrical. Too high means compaction never fires
    // and the conversation dies; too low means compacting early, which costs
    // tokens and breaks nothing.
    assert_eq!(
        context_window_for("some-experimental-merge-q4", true, None),
        UNKNOWN_LOCAL_WINDOW
    );
    assert!(UNKNOWN_LOCAL_WINDOW < 200_000);
}

#[test]
fn something_unknown_and_hosted_is_assumed_larger() {
    assert_eq!(
        context_window_for("acme-future-model", false, None),
        UNKNOWN_HOSTED_WINDOW
    );
}

#[test]
fn the_name_is_matched_without_regard_to_case() {
    assert_eq!(context_window_for("Claude-Opus-5", false, None), 200_000);
}

#[test]
fn a_model_served_from_this_machine_is_local() {
    assert!(is_local_endpoint("http://127.0.0.1:1234/v1"));
    assert!(is_local_endpoint("http://localhost:11434/v1"));
    assert!(is_local_endpoint("http://192.168.1.20:1234/v1"));
    assert!(!is_local_endpoint("https://api.anthropic.com/v1"));
    assert!(!is_local_endpoint("https://api.openai.com/v1"));
}
