# One Harness Measurements

**Date:** 2026-08-08
**Status:** First figure recorded. The turn-level gate in
`docs/specs/2026-08-08-one-harness-design.md` §9 is not yet runnable — it needs the spoken loop on
`foolrs`, which is the next plan.
**Base:** The Fool v2.3.10, branch `feat/one-harness`

This file exists because the design makes the merge conditional on numbers rather than on an
argument. A threshold nobody can reproduce is not a threshold, so every figure here comes with the
command that produced it.

---

## 1. What one call through the channel costs

The risk named in the design (§10) was that an app tool call now crosses a process boundary twice.
This measures exactly that overhead: the renderer's own work is stubbed to zero, so what is left is
transport and bookkeeping. Anything measured later is this plus the handler.

```bash
cd backend/core
cargo run -p fool-app-tools --example measure_channel --release
```

| Figure | Value    |
| ------ | ---------- |
| Calls  | 200      |
| Median | 3.254 ms |
| p95    | 3.604 ms |
| Worst  | 4.404 ms |

Recorded 8 August 2026, Windows 11, release profile, after a twenty-call warm-up that is discarded.

**Read this as the pessimistic figure.** Every call in the loop opens a fresh TCP connection, which a
real MCP client does not: it connects once and reuses. So the number includes a connect that most
calls will not pay.

**The conclusion it supports.** Against a spoken turn — where time to first audio is measured in
hundreds of milliseconds and a screen capture alone is seconds — 3.3 ms is not where the time goes.
The boundary crossing is not the latency risk in this design, and no work should be spent optimising
it until something measured says otherwise.

**What it does not say.** It says nothing about the handler, the model, or the turn. Those are the
figures the merge is actually gated on, and they cannot be taken until the spoken loop runs on
`foolrs`.

### A note on running it

The example may fail to link with `LNK1104 … cannot open measure_channel.exe` while the file itself
appears not to exist. That is a pending-delete lock, the same class of failure as this project's
known `out/win-unpacked` EPERM. Build to another target directory rather than waiting:

```bash
CARGO_TARGET_DIR=/tmp/fool-measure cargo run -p fool-app-tools --example measure_channel --release
```

---

## 2. Still to be measured

These are the figures §9 of the design gates the merge on. None can be taken yet.

| Figure                       | Why it is not here yet                                         |
| ---------------------------- | ---------------------------------------------------------------- |
| Rounds per spoken turn       | The spoken loop still runs in the renderer                     |
| Prompt tokens per turn       | Needs the `usage` figures from the local endpoint, not chars   |
| Milliseconds to first audio  | Needs the merged path to compare against today's               |
| Total milliseconds per turn  | As above                                                       |
| Tool calls and their success | Needs the ten-task set, against `gemma-4-e4b` on an 8 GB card  |

The ten tasks themselves are not written down yet either. They belong with the plan that moves the
loop, because a task list written before the thing it tests is a guess.
