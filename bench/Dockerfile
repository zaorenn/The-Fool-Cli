# syntax=docker/dockerfile:1

# The agent, in a Linux container, because that is where every benchmark runs.
#
# Terminal-Bench, SWE-bench and HAL all put the agent inside the task's own
# image and talk to it over a shell. Nothing about this is specific to one of
# them: what they need is a binary that takes a task and exits with a verdict,
# which is `foolrs --print`.
#
#   docker build -f bench/Dockerfile -t thefool/agent:dev .
#   docker run --rm -e API_KEY -e PROVIDER=anthropic -e MODEL=claude-opus-5 \
#     -v "$PWD:/workspace" thefool/agent:dev "fix the failing test"

FROM rust:1.96-slim-bookworm AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends pkg-config ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY backend/agent ./

# rustls, not OpenSSL — the workspace already chose it so there is no system
# TLS dependency to carry into the runtime image.
RUN cargo build --release -p foolrs-cli --locked

FROM debian:bookworm-slim

# What a coding task needs to exist at all. Deliberately short: a benchmark's
# own image supplies the language toolchains, and anything added here that the
# task did not ask for is a difference between this run and everyone else's.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git curl jq ripgrep \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/target/release/foolrs /usr/local/bin/foolrs
COPY bench/entrypoint.sh /usr/local/bin/fool-task
RUN chmod +x /usr/local/bin/fool-task

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/fool-task"]
