# Running the agent from a terminal

The same runtime the application thinks with can be driven from a shell, one
task at a time, with no window open. This is what a benchmark harness needs, and
what a CI job needs, and they need the same three things: a prompt in, a result
out, and an exit code that means something.

## One task

```bash
foolrs --print --output-format json --auto-approve "fix the failing test in src/parser.rs"
```

`--print` runs the prompt and exits instead of opening the REPL. Without a
prompt on the command line it reads one from stdin, so a harness can pipe the
task in:

```bash
cat task.txt | foolrs --print --output-format json --auto-approve
```

A bare invocation whose stdin is a pipe does the same thing without the flag —
being answered with an interactive prompt when you piped a task in is never what
was meant.

> `-p` is `--provider`, and has been since before `--print` existed. Taking the
> short form would have turned `-p anthropic` into a run whose prompt is the
> word "anthropic".

## What comes back

With `--output-format json`, stdout carries exactly one object and nothing else:

```json
{
  "type": "result",
  "is_error": false,
  "result": "The test failed because …",
  "stop_reason": "EndTurn",
  "turns": 7,
  "duration_ms": 41230,
  "session_id": "…",
  "usage": {
    "input_tokens": 82154,
    "output_tokens": 3901,
    "cache_creation_tokens": 0,
    "cache_read_tokens": 76800
  }
}
```

A run that fails writes the same shape with `"is_error": true` and an `error`
string, and exits non-zero. It does not write nothing: a caller that gets an
empty stdout cannot tell a crash apart from a task the agent decided needed no
answer.

Exit codes: `0` for a completed run, non-zero for a refused flag, a missing
prompt, or a run that ended in an error.

## The model

Nothing is bundled. Point it at whatever you have:

```bash
foolrs --provider anthropic --model claude-opus-5 --api-key "$ANTHROPIC_API_KEY" --print …
foolrs --provider openai --base-url http://127.0.0.1:1234/v1 --model local-model --print …
```

`PROVIDER`, `API_KEY`, `BASE_URL` and `MODEL` work as environment variables, so
a harness that already sets those needs no flags at all.

## Guards worth setting

| Flag                              | Why a harness wants it                                                            |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `--auto-approve`                  | Nothing is watching to answer a permission prompt.                                |
| `--max-turns N`                   | A task that cannot be finished stops costing money. Defaults to 20; `0` disables. |
| `--max-tool-call-failure-turns N` | Stops a loop that keeps calling a tool that keeps failing.                        |
| `--project-dir DIR`               | Where `.foolrs.toml` is read from; defaults to the working directory.             |
| `--log-dir DIR`                   | Logs go to files instead of the terminal, leaving stdout clean.                   |

## What this is not, yet

- **No container.** The agent runs directly on the machine it is started on.
  Benchmarks that require their tasks to run inside an image (Terminal-Bench,
  SWE-bench) need one built around this binary; nothing here provides it.
- **No Linux build in the release.** The workspace compiles on Linux and only
  Windows artefacts are published, so a harness on Linux builds from source.
- **The application's own tools are not in this.** Looking at the screen,
  driving the machine and running a taught skill live in the desktop
  application and reach an agent through `foolcore app-tools-bridge`. A
  terminal run has files, commands, search, fetch, skills and sub-agents —
  the coding-agent surface, not the desktop one.
