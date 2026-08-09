use std::env;
use std::io::{IsTerminal, Read};
use std::sync::Arc;
use std::time::Instant;

use foolrs_agent::engine::{AgentEngine, AgentResult};
use foolrs_agent::error::AgentError;
use foolrs_agent::output::OutputSink;
use foolrs_agent::output::null_sink::NullSink;
use foolrs_agent::output::terminal::TerminalSink;
use serde_json::json;

use crate::bootstrap::{build_engine, init_logging, resolve_config};
use crate::cli::Cli;
use crate::json_stream;

/// How a one-shot run reports itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OutputFormat {
    /// The transcript, as a person reads it.
    Text,
    /// One object on stdout and nothing else, for a caller that parses rather
    /// than scrapes — a benchmark adapter, a CI job, another program.
    Json,
}

impl OutputFormat {
    pub(crate) fn parse(value: Option<&str>) -> anyhow::Result<Self> {
        match value {
            None | Some("text") => Ok(Self::Text),
            Some("json") => Ok(Self::Json),
            Some(other) => anyhow::bail!("Unknown --output-format '{other}' (expected 'text' or 'json')"),
        }
    }
}

/// Entry point for the default (non-subcommand) invocation: validates
/// flags, resolves config/logging, then either dispatches to JSON stream
/// mode or bootstraps an engine and runs a single prompt / REPL.
pub(crate) async fn run_main_flow(cli: Cli) -> anyhow::Result<()> {
    if cli.resume.is_some() && cli.session_id.is_some() {
        anyhow::bail!("Cannot use --resume and --session-id together");
    }
    let format = OutputFormat::parse(cli.output_format.as_deref())?;

    // The prompt is read before anything is built, because a caller that pipes
    // one in and gets a REPL prompt back has no way to tell the difference
    // between a wedged agent and a mode it did not ask for.
    let prompt = resolve_prompt(&cli)?;
    let one_shot = !prompt.is_empty();

    let terminal = Arc::new(TerminalSink::new(cli.no_color));
    // In JSON mode the object on stdout is the whole of the output: a
    // transcript printed beside it would have to be stripped back off by
    // whatever is parsing.
    let output: Arc<dyn OutputSink> = match format {
        OutputFormat::Text => terminal.clone(),
        OutputFormat::Json => Arc::new(NullSink),
    };

    let config = resolve_config(&cli)?;
    let _log_guard = init_logging(&config, cli.log_dir.as_deref(), cli.log_level.as_deref());

    let cwd = env::current_dir()?.to_string_lossy().to_string();

    // Branch to JSON stream mode
    if cli.json_stream {
        return json_stream::run(config, &cwd, cli.resume, cli.session_id).await;
    }

    let provider_name = config.provider_label.clone();
    let terminal_for_resume = terminal.clone();

    let announce_resume = format == OutputFormat::Text;
    let result = build_engine(config, &cwd, output.clone(), cli.resume.as_deref(), |session| {
        if announce_resume {
            terminal_for_resume.formatter().session_info(&format!(
                "Resumed session {} ({} messages, {} model)",
                session.id,
                session.messages.len(),
                session.model
            ));
        }
    })
    .await?;
    let mut engine = result.engine;

    if cli.resume.is_none() {
        engine.init_session(&provider_name, &cwd, cli.session_id.as_deref())?;
    }

    let mut failure = None;
    if one_shot {
        let started = Instant::now();
        match engine.run(&prompt, "").await {
            Ok(run_result) => report_run(&output, format, &engine, &run_result, started),
            // In JSON mode the failure is the result: a caller that gets
            // nothing on stdout cannot tell a crash from a task the agent
            // decided needed no answer.
            Err(error) => {
                if format == OutputFormat::Json {
                    print_json(&json!({
                        "type": "result",
                        "is_error": true,
                        "error": error.to_string(),
                        "duration_ms": started.elapsed().as_millis() as u64,
                        "session_id": engine.current_session_id(),
                    }));
                }
                failure = Some(error);
            }
        }
    } else {
        repl_loop(&mut engine, &terminal, &output).await?;
    }

    // The hooks and the MCP servers are shut down on the failing path too: a
    // run that ends badly still has to leave the machine as it found it.
    engine.run_stop_hooks().await;

    for mgr in &result.mcp_managers {
        mgr.shutdown().await;
    }

    match failure {
        Some(error) => Err(error.into()),
        None => Ok(()),
    }
}

/// What the run is being asked to do.
///
/// Empty means the REPL. `--print` with nothing on the command line reads
/// stdin, and so does a bare invocation whose stdin is a pipe rather than a
/// terminal — piping a task in and being answered with an interactive prompt is
/// never what the caller meant.
fn resolve_prompt(cli: &Cli) -> anyhow::Result<String> {
    let argument = cli.prompt.join(" ");
    if !argument.trim().is_empty() {
        return Ok(argument);
    }
    if !cli.print && std::io::stdin().is_terminal() {
        return Ok(String::new());
    }
    if cli.json_stream {
        // That mode owns stdin itself.
        return Ok(String::new());
    }

    let mut piped = String::new();
    std::io::stdin().read_to_string(&mut piped)?;
    let piped = piped.trim().to_owned();
    if piped.is_empty() && cli.print {
        anyhow::bail!("--print was given no prompt, on the command line or on stdin");
    }
    Ok(piped)
}

/// Report a finished one-shot run.
fn report_run(
    output: &Arc<dyn OutputSink>,
    format: OutputFormat,
    engine: &AgentEngine,
    result: &AgentResult,
    started: Instant,
) {
    match format {
        OutputFormat::Text => output.emit_stream_end(
            "",
            result.turns,
            result.usage.input_tokens,
            result.usage.output_tokens,
            result.usage.cache_creation_tokens,
            result.usage.cache_read_tokens,
        ),
        OutputFormat::Json => print_json(&json!({
            "type": "result",
            "is_error": false,
            "result": result.text,
            "stop_reason": format!("{:?}", result.stop_reason),
            "turns": result.turns,
            "duration_ms": started.elapsed().as_millis() as u64,
            "session_id": engine.current_session_id(),
            "usage": {
                "input_tokens": result.usage.input_tokens,
                "output_tokens": result.usage.output_tokens,
                "cache_creation_tokens": result.usage.cache_creation_tokens,
                "cache_read_tokens": result.usage.cache_read_tokens,
            },
        })),
    }
}

fn print_json(value: &serde_json::Value) {
    println!("{}", serde_json::to_string(value).unwrap_or_default());
}

async fn repl_loop(
    engine: &mut AgentEngine,
    terminal: &Arc<TerminalSink>,
    output: &Arc<dyn OutputSink>,
) -> anyhow::Result<()> {
    use std::io::{self, BufRead};

    loop {
        terminal.formatter().repl_prompt();

        let mut input = String::new();
        io::stdin().lock().read_line(&mut input)?;
        let input = input.trim();

        if input.is_empty() {
            break;
        }

        match engine.run(input, "").await {
            Ok(result) => {
                if result.turns > 0 {
                    output.emit_stream_end(
                        "",
                        result.turns,
                        result.usage.input_tokens,
                        result.usage.output_tokens,
                        result.usage.cache_creation_tokens,
                        result.usage.cache_read_tokens,
                    );
                }
            }
            Err(AgentError::UserAborted) => break,
            Err(e) => {
                output.emit_error(&e.to_string());
            }
        }
    }

    Ok(())
}

#[cfg(test)]
#[path = "run_test.rs"]
mod run_test;
