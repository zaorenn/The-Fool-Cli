$ErrorActionPreference = "Stop"

# Thin cargo wrapper: the single entry point the justfile recipes call.
#
# This used to carry a `[patch]` block redirecting the agent SDK's git
# dependency at a checkout on disk. The agent crates now live in this repo
# under backend/agent/crates and are consumed by path, so there is no git
# source left to patch — editing them in place is the whole workflow.

& cargo @args
exit $LASTEXITCODE
