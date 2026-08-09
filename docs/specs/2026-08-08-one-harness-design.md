# One Harness Design

**Date:** 2026-08-08
**Status:** Designed, not built. This is the first of eight sub-projects; the ones after it are listed in §11.
**Base:** The Fool v2.3.10, branch `main`
**Depends on:** the in-process MCP server pattern established by `fool-team`, and the confirmation
channel between the backend and the renderer

## 1. Objective

Make one agent runtime serve every conversation in the app, spoken or typed.

There are two agent loops in this application today and the weaker one is in front of the user. The
capable one is `foolrs`: it has file and shell tools, automatic context compaction, plan mode,
sub-agents, a skill system and a memory index. The one a spoken conversation actually runs is
`localPipeline.ts` in the renderer, which reimplements a turn loop with eighteen `app_*` tools, a
budget of four tool rounds (`MAX_TOOL_ROUNDS`), and a history that is truncated at twelve turns
(`MAX_HISTORY_TURNS`) with no compaction at all. Anything real is handed over an IPC boundary to a
chat conversation that runs the capable loop.

So the assistant a user talks to cannot read a file, cannot run a command, cannot remember more than
twelve turns, and gives up after four tool calls — not because those things are hard, but because
the loop it runs is not the loop that has them.

The goal of this sub-project is that the sentence above stops being true, and that nothing else about
the product regresses while it stops being true.

## 2. Why this shape

Three facts about the codebase decide most of the design.

1. **The reverse channel already exists and is proven.** `fool-team` runs its own MCP server inside
   the backend process (`fool-team/src/mcp/server.rs`), and the backend binary carries an
   `mcp-bridge` subcommand that proxies stdio to it. Every agent session gets it injected with a
   port and a token — `factory/foolrs.rs` for the embedded agent, `factory/acp_assembler.rs` for
   CLI agents. An agent calling back into the app's own subsystems is not a new idea here; it is a
   pattern with a working instance. This design is its second instance.

2. **Backend-to-renderer requests already have a path.** Tool confirmations travel out over the
   websocket as `confirmation.add` and come back as an HTTP POST to
   `/api/conversations/:id/confirmations/:call_id/confirm`. That is exactly the shape an app tool
   call needs: an outbound request the renderer can answer. Nothing new has to be invented for the
   transport either.

3. **Because the channel is MCP, hosted agents get it too.** The app's own capabilities — looking at
   the screen, changing the theme, the memory, the taught skills — arrive at any agent that speaks
   MCP, which includes the Claude Code and Codex sessions the app hosts. The long-standing complaint
   that typed chat is a second-class citizen is closed as a by-product of the transport choice
   rather than as a separate feature.

## 3. Scope

### 3.1 Included

- An in-process `fool-app` MCP server exposing the app's own capabilities as tools.
- Migration of every `app_*` tool onto that server, with the existing renderer handlers
  (`runVoiceTool` in `renderer/pages/voice/runtime/toolRunner.ts`) kept as the implementation.
- A spoken-session profile in `foolrs`: the app tools, the persona, the memory and the taught skills,
  with speech in and a token stream out.
- Moving the action-claim gate (`common/voice/actionClaims.ts`) to the single output path so it
  covers every provider and typed chat, rather than the local pipeline alone.
- Deferred tool loading for small models, and a real context window instead of the current default.
- A before-and-after measurement that decides whether the merge ships.
- Deletion of the renderer's turn loop once the measurement passes.

### 3.2 Excluded, and where it goes instead

Each of these is a sub-project of its own and is listed in §11. None of them is dropped.

- The permission layer, sandbox selection, checkpoints and undo.
- `WebFetch`, `WebSearch` and background command execution.
- Instant barge-in, typed input during a spoken conversation, and the screen-to-skill flow.
- Unifying the five skill systems and four memory stores, and the learning loop.
- Sub-agent visibility.

### 3.3 Explicitly unchanged

The renderer keeps audio capture, WAV conversion, the sentence queue, the look-ahead renderer and
the barge-in flush. Those are correct, they are tested, and they are about sound rather than about
agency.

## 4. Architecture

Three layers with one seam each.

**`foolrs` owns the conversation.** The turn loop, the tool registry, compaction, plan mode,
sub-agents and the file and shell tools live here, as they already do. A spoken conversation and a
typed one are the same session kind; they differ only in where the input came from and whether the
output is spoken.

**`fool-app` carries the app's own capabilities.** It is an MCP server in the backend process, built
as a sibling of `fool-team`: its own TCP listener, its own token, the same `mcp-bridge` proxy, and
the same injection points. It performs no work itself. It forwards a call to the application and
returns what comes back.

**The renderer is a device and a set of handlers.** Microphone, speaker, screen, windows, and the
existing tool implementations. It has no turn loop, no history, no tool-round budget and no prompt
assembly, because all four exist in better form one layer down.

## 5. The reverse tool channel

A call travels the path a confirmation already travels:

1. `foolrs` calls `app_look_at_screen`; the call reaches the `fool-app` MCP server.
2. The server emits an app-tool request to the renderer over the realtime broadcaster, addressed by
   conversation and call id.
3. The renderer dispatches it to `runVoiceTool`. That function is not rewritten; only its caller
   changes.
4. The result returns as an HTTP POST, in the shape confirmations already use.
5. The server returns it to `foolrs` as a tool result and the turn continues.

**Failure is explicit.** Every call carries a deadline. If the renderer is gone, busy or slow, the
tool returns an error the model can say out loud — "the screen cannot be read right now" — never a
silent success. This is the contract the action-claim gate depends on: a tool that can report
success without proof will eventually report one.

**Ordering.** Calls are answered per conversation in the order they were issued, because two spoken
turns can overlap while a long task runs and a result delivered to the wrong turn is worse than a
result delayed.

## 6. A spoken turn, end to end

```
microphone → VAD → STT ──► foolrs turn ──► token stream
                                │               │
                        tool calls        split into sentences → claim gate → TTS → speaker
                     (native + app MCP)                                             ▲
                                                                                    │
        live phrase listener ("stop") ────────── immediate flush ───────────────────┘
```

Three things about this picture matter more than the rest.

**The claim gate stays in front of the speaker.** It is there today for a reason worth preserving: a
reply is spoken a sentence at a time while the rest is still being written, so checking the finished
text would catch a false claim only after the user had heard it. What changes is that there is now
one output path rather than four, so the guarantee covers the local pipeline, OpenAI Realtime,
Gemini Live and typed chat instead of the first alone.

**Interruption is not part of this loop.** The live phrase listener cancels the turn and flushes the
speaker directly. Wiring it up belongs to the spoken-experience sub-project (§11.3); this design only
requires that a `foolrs` turn can be cancelled from outside and that cancellation reaches the
speaker.

**Reasoning output is never spoken.** The local model streams `reasoning_content` before its answer.
It is not split into sentences and never reaches the speaker; it drives the on-screen thinking state
instead. Getting this wrong reads to a user as the assistant talking to itself.

## 7. Small-model discipline

Two things have to be true before a small local model can hold this, and neither is true today.

**Tools load in tiers.** Every tool in `foolrs` carries an `is_deferred()` flag: a deferred tool is
advertised as a name and a truncated stub, and `ToolSearch` loads the full schema when it is wanted.
A spoken conversation advertises a small core — looking at the screen, delegating a task, searching,
opening, running a taught skill, remembering, standing by — and defers the rest, including the file
and shell tools and every user-installed MCP server.

A small model may forget to search. That is not answered with an instruction. Two mechanical nets
carry it: a taught skill is matched and run without consulting the model at all, as it is today
through `findLocalSkill`; and the tool group a request obviously needs is opened before the turn
starts, from the same matching, so the tool is present even when the model would not have asked for
it.

**The context window has to be the real one.** `foolrs-config`'s compaction defaults to a
`context_window` of 200,000 tokens with a 20,000-token output reserve and a 13,000-token buffer, and
nothing in this repository sets it from the model actually loaded. On a small local model that
threshold is never reached, so automatic compaction never runs and the model overruns its window
instead — which is the opposite of the intended behaviour, and silent. The window is read from the
model where the endpoint reports it, falls back to a conservative figure where it does not, and is
shown in settings so a wrong value is visible rather than mysterious.

Two smaller corrections ride along. Prompt size is measured in tokens taken from the endpoint's own
`usage`, not in characters, because a figure used to decide whether compaction fires has to be the
same figure the model counts. And the persona, memory and skill preamble is assembled once and kept
stable across turns rather than rebuilt every time, so a local model's cache is reused instead of
invalidated on every sentence.

## 8. Steps, and the flag

Six steps. Each is complete and tested on its own; the flag stays off until §9 passes, so a partly
merged app is never something a user can install.

| #   | Step                                                                                          | True when it lands                                        |
| --- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | `fool-app` MCP server, `mcp-bridge` reuse, one tool end to end (`app_look_at_screen`)         | An agent can read the screen; no user-visible change      |
| 2   | The remaining `app_*` tools move onto the channel, renderer handlers kept                     | One tool registry; typed chat can use the app's own tools |
| 3   | Spoken session profile in `foolrs`: app tools, persona, memory, skills; speech in, tokens out | A whole spoken turn runs on `foolrs`, behind the flag     |
| 4   | The claim gate moves to the single output path                                                | No surface can claim work it did not do                   |
| 5   | Before-and-after measurement on the local model                                               | Numbers exist; the flag opens only if they hold           |
| 6   | The renderer's turn loop is deleted                                                           | One harness                                               |

Step 5 is a gate rather than a report. If the merged path is slower to first audio, or takes more
rounds, or completes fewer tasks, the flag does not open and the result is a regression to fix, not
a release to announce.

## 9. Testing and the measurement gate

**Unit.** Rust modules keep their `*_test.rs` neighbour, as the crates already do. The renderer's
handlers keep their existing tests; their caller changes, not their behaviour.

**Integration.** The `fool-app` server is tested against a stub renderer: a call is issued, answered,
and returned; a call is issued and never answered, and the deadline produces an error rather than a
hang; two calls overlap and come back in order.

**End to end.** A Playwright Electron spec runs a spoken turn against a stubbed model, asserting that
a tool call reaches the renderer and that the spoken result matches what the tool returned.

**The gate.** Ten representative tasks, run before and after against `gemma-4-e4b` on an 8 GB card,
which is the machine class the product claims. Recorded per turn: rounds, prompt tokens,
milliseconds to first audio, total milliseconds, tool calls, and whether the task completed. The flag
opens only if the median time to first audio is no worse than today's, the round count has not risen,
and the completion rate has not fallen. The tasks, the exact commands and the resulting numbers go in
`docs/specs/2026-08-08-one-harness-measurements.md`, because a threshold nobody can reproduce is not
a threshold.

**House hazards to respect.** The suite is run with `--maxWorkers=2`, since default parallelism
silently drops whole files. `foolcore` is rebuilt with a neutral `CARGO_HOME`. A killed build has
its `out/win-unpacked` deleted twice before the next one. A build's exit code is read from the log
and the artifact on disk, never from a pipeline. `MotionBuilder.tsx` is checked after any
`lint:fix`. Every new user-facing string ships in all thirteen languages.

## 10. Risks

**Latency through one more hop.** An app tool call now crosses a process boundary twice. It is
measured in step 5 rather than argued about here; the mitigation, if it is needed, is that the
handful of tools which are pure UI state can be answered without waking the model.

**A cancelled turn leaving work behind.** A spoken turn can be cancelled mid-tool. The tool call is
already in the renderer at that point, and the design requires cancellation to reach it — otherwise
a barge-in leaves a theme half-applied or a task running that nobody is listening for.

**The flag becoming permanent.** A feature flag that never opens is a second harness with extra
steps, which is the thing this sub-project exists to remove. Step 6 deletes the old loop; the
sub-project is not finished until it is gone.

## 11. What comes after

In order, each with its own design document:

1. **Safety and undo** — permission rules with path and command scope, confirmation for anything
   irreversible, checkpoints with rollback, and the sandbox-or-real-machine choice made per
   conversation rather than per install.
2. **Native tools** — `WebFetch`, `WebSearch`, background command execution, and a headless path.
3. **The spoken experience** — instant interruption, typed input during a conversation, the pending
   question state, and resolving something seen on screen into a saved skill.
4. **Shared memory and learning** — one skill system instead of five, one memory instead of four,
   snapshots and rollback, and an end-of-session proposal of what was learned, with evidence, that
   the user approves before it is written.
5. **Evaluation** — the task set locked, grown by every sub-project above, wired to a regression
   gate.
6. **Sub-agent visibility** — children stream instead of writing to a null sink, and each one's work
   can be watched.
7. **Product** — signing, installer size, a test suite whose exit code can be trusted, and opt-in
   diagnostics.
