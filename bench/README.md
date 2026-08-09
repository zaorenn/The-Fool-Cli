# Benchmarks

**There are no numbers here yet, and none will be written down that were not
measured.** This directory holds what a benchmark run needs, and this file says
exactly what is still missing between here and a score.

## What exists

| Piece | State |
| --- | --- |
| One task in, one result out (`foolrs --print --output-format json`) | **Done** — see [docs/guides/headless-agent.md](../docs/guides/headless-agent.md) |
| A Linux container with the agent in it (`bench/Dockerfile`) | **Written, never built** — there is no Docker on the machine this was written on |
| The container's contract (`bench/entrypoint.sh`) | Done |
| A harness adapter | **Not written** — see below |
| A model to run it with | Yours to supply |

## What a score costs

Three things, and none of them are code:

1. **Docker.** Terminal-Bench and SWE-bench run each task inside its own image
   and put the agent in beside it. Neither can run on a machine without it.
2. **A model, and the money it costs.** A benchmark run is hundreds of tasks ×
   several attempts × a full agent loop each. The score is mostly a fact about
   the model; the harness is worth 10–20 points on top of it, which is exactly
   why the harness is worth working on — but a local 8 GB model will not
   produce a headline number, and pretending otherwise in a README would be
   the same failure this project keeps fixing everywhere else.
3. **Reproducibility.** A self-reported number nobody else can reproduce is
   worth very little: Prime Agent's ARC-AGI-3 result is not on the official
   leaderboard for exactly that reason. Anything published here should carry
   the command, the model, the date, and the run's raw output.

## The adapter

Terminal-Bench 2.0 is driven through Harbor, and an agent that installs from a
command line implements `AbstractInstalledAgent`: an install script, the
command that runs one task, and the environment it needs. It is then pointed at
by import path:

```bash
harbor run -d terminal-bench@2.0 --agent-import-path thefool_bench:FoolAgent -m anthropic/claude-opus-5 -n 4
```

That adapter is roughly forty lines of Python, and it is not in this repository
yet **because it must be written against the interface as it actually is**, not
as it is remembered. Read `AbstractInstalledAgent` in the installed Harbor
package first, then write it: the install script is `bench/Dockerfile`'s runtime
half, and the run command is `fool-task "$INSTRUCTION"`.

## The order to do this in

1. Build the image and prove a task runs end to end in it — one task, by hand.
2. Write the Harbor adapter; run ten tasks; read the failures.
3. Fix what the failures show. This is the part that moves a score: turn
   limits, tool-call retries, what the agent does when a command hangs, how
   much of the transcript survives compaction.
4. Only then run the full set, and publish the number with the command beside
   it.

Until step 4, the honest thing to put in the top-level README is nothing.
