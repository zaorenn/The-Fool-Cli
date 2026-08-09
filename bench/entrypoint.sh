#!/usr/bin/env bash
# One task in, one result out. The whole of the contract a benchmark harness
# needs from an agent, and the reason it is a file rather than a long docker
# CMD: every adapter that drives this should be driving the same thing.
set -euo pipefail

# A benchmark run has nobody to answer a permission prompt, and a task that
# cannot be finished has to stop costing money rather than loop.
ARGS=(--print --output-format json --auto-approve --max-turns "${FOOL_MAX_TURNS:-60}")

if [ "$#" -gt 0 ]; then
  exec foolrs "${ARGS[@]}" "$@"
fi

# No argument: the instruction is on stdin, which is how most harnesses pass a
# task that runs to several paragraphs.
exec foolrs "${ARGS[@]}"
