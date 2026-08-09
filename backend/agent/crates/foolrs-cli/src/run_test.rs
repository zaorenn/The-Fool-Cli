use clap::Parser;

use super::{OutputFormat, resolve_prompt};
use crate::cli::Cli;

fn parse(args: &[&str]) -> Cli {
    Cli::try_parse_from(args).expect("cli should parse")
}

#[test]
fn output_format_defaults_to_text() {
    assert_eq!(OutputFormat::parse(None).unwrap(), OutputFormat::Text);
    assert_eq!(OutputFormat::parse(Some("text")).unwrap(), OutputFormat::Text);
    assert_eq!(OutputFormat::parse(Some("json")).unwrap(), OutputFormat::Json);
}

/// A misspelled format is refused rather than quietly treated as text. A
/// caller asking for JSON and getting a transcript parses nothing and reports
/// the agent as broken.
#[test]
fn an_unknown_output_format_is_refused() {
    let err = OutputFormat::parse(Some("yaml")).unwrap_err();
    assert!(err.to_string().contains("yaml"), "{err}");
}

#[test]
fn a_prompt_on_the_command_line_is_the_prompt() {
    let cli = parse(&["foolrs", "--print", "fix", "the", "build"]);
    assert_eq!(resolve_prompt(&cli).unwrap(), "fix the build");
}

/// `--print` is what a harness passes; the flags it needs beside it have to
/// survive the same parse.
#[test]
fn print_and_json_parse_together() {
    let cli = parse(&[
        "foolrs",
        "--print",
        "--output-format",
        "json",
        "--auto-approve",
        "--max-turns",
        "50",
        "solve it",
    ]);

    assert!(cli.print);
    assert!(cli.auto_approve);
    assert_eq!(cli.max_turns, Some(50));
    assert_eq!(
        OutputFormat::parse(cli.output_format.as_deref()).unwrap(),
        OutputFormat::Json
    );
}

/// `-p` stays with `--provider`. Taking it for `--print` would leave
/// `-p anthropic` parsing as a one-shot run whose prompt is "anthropic".
#[test]
fn the_short_p_still_names_a_provider() {
    let cli = parse(&["foolrs", "-p", "anthropic", "hello"]);
    assert!(!cli.print);
    assert_eq!(cli.provider.as_deref(), Some("anthropic"));
    assert_eq!(cli.prompt, vec!["hello"]);
}

/// `--json-stream` owns stdin for its own protocol, so the one-shot reader must
/// not consume it looking for a prompt.
#[test]
fn json_stream_keeps_its_own_stdin() {
    let cli = parse(&["foolrs", "--json-stream"]);
    assert_eq!(resolve_prompt(&cli).unwrap(), "");
}
