# Spoken Turn on foolrs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the spoken conversation's turn loop out of the renderer and onto `foolrs`, so there is
one agent runtime behind voice and text, and delete the renderer's loop once the move is measured to
have cost nothing.

**Architecture:** A spoken session becomes an ordinary `foolrs` conversation, created once and reused,
carrying the persona, memory and taught skills as its system prompt and the application's own tools
over the MCP channel built in the previous plan. The renderer sends transcribed speech in and
consumes the response stream, splitting it into sentences for the speaker exactly as it does today.
Barge-in cancels the turn through the existing cancel route.

**Tech Stack:** TypeScript (Electron renderer, vitest); Rust (`fool-conversation`, `fool-ai-agent`)
only where the spoken profile needs something the chat profile does not.

**Scope:** steps 3 to 6 of `docs/specs/2026-08-08-one-harness-design.md` §8. Steps 1 and 2 are done
and released to the branch — see `2026-08-08-one-harness-plan.md`.

## Global Constraints

- TypeScript: strict mode, no `any`, `type` over `interface`, single quotes, path aliases `@/*`,
  `@process/*`, `@renderer/*`.
- Components from `@arco-design/web-react`, icons from `@icon-park/react`; no raw interactive HTML.
- Every user-facing string is an i18n key present in all thirteen locales.
- Vitest is run as `bunx vitest run --maxWorkers=2 <paths>`.
- Rust tests are run from `backend/core` as `cargo test -p <crate>`. **Never `--workspace` for a
  routine check**: it links 171 test binaries and takes over an hour on this machine. Run the crates
  you touched.
- Conventional Commits, **no AI signature of any kind**.
- No real user name, e-mail, or absolute path containing one, in any committed file.

## What was verified before this plan was written

Each of these was read in the tree rather than assumed, because the plan depends on all four.

| Mechanism                         | Where it is                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| System prompt reaches the session | `fool-conversation/src/session_context.rs:436` parses `FoolrsBuildExtra` from `extra` |
| Token-level streaming             | `conversation.responseStream`, `type: 'content' \| 'text'`, `data` is a delta      |
| A turn can be cancelled           | `conversation.stop` → `POST /api/conversations/{id}/cancel`, needs `turn_id`       |
| The turn id is reachable          | `TConversationRuntimeSummary.turn_id`, the same source `useConversationRuntimeView` reads |

**One thing is decided here rather than in the design, because the design did not face it.** Today
the spoken system prompt is rebuilt mid-conversation whenever the memory changes or the user sets a
rule out loud (`localPipeline.refreshSystemPrompt`). A `foolrs` session builds its system prompt once,
at session build, so that trick is not available. Rebuilding the session would throw away the
conversation; leaving the change until next time would mean agreeing to a rule and then ignoring it,
which is the exact failure the current code was written to avoid.

**So a mid-session change is injected as a turn rather than rewritten into the prompt.** The next
message carries the instruction ahead of what the user said. It is visible to the model in the place
models are most reliable at reading, it costs nothing, and it is honest about when the instruction
arrived. Task 4 implements it.

---

### Task 1: A spoken session, created once and reused

**Files:**
- Create: `packages/desktop/src/renderer/services/voice/session/spokenSession.ts`
- Create: `tests/unit/renderer/voice/spokenSession.test.ts`

**Interfaces:**
- Consumes: `buildPersonaInstructions` from `@/common/realtime`, `peekVoiceMemory`, `peekLocalSkills`, `findPinnedAssistant`, `findPinnedModel` from `./startVoiceConversation`.
- Produces: `openSpokenSession(input: SpokenSessionInput): Promise<SpokenSessionResult>` where
  `SpokenSessionInput = { settings: FoolVoiceSettings; interfaceLanguage: string; voices: readonly SpokenVoice[]; sessionRules: readonly string[] }`
  and `SpokenSessionResult = { ok: true; conversationId: string } | { ok: false; reason: 'no-agent' | 'agent-unavailable' | 'create-failed'; detail?: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/renderer/voice/spokenSession.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn(async () => ({ id: 'conversation-1' }));
const listAssistants = vi.fn(async () => [{ id: 'a1', name: 'The Fool', agent: { type: 'foolrs' } }]);
const listProviders = vi.fn(async () => [{ id: 'p1', use_model: 'gemma-4-e4b', model: ['gemma-4-e4b'] }]);
const listServers = vi.fn(async () => []);

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { create },
    assistants: { list: { invoke: listAssistants } },
    mode: { listProviders: { invoke: listProviders } },
    mcpService: { listServers: { invoke: listServers } },
  },
}));

const { openSpokenSession } = await import('@renderer/services/voice/session/spokenSession');

describe('openSpokenSession', () => {
  beforeEach(() => create.mockClear());

  it('carries the persona, the memory and the skills as the session prompt', async () => {
    await openSpokenSession(input());
    const extra = create.mock.calls[0][0].extra as { system_prompt?: string };
    expect(extra.system_prompt).toContain('The Fool');
  });

  it('names the conversation so the list does not fill with untitled rows', async () => {
    await openSpokenSession(input());
    expect(create.mock.calls[0][0].name).toBeTruthy();
  });

  it('reports no-agent rather than throwing when nothing is pinned', async () => {
    listAssistants.mockResolvedValueOnce([]);
    const result = await openSpokenSession(input());
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'no-agent' }));
  });
});
```

Write `input()` in the test file returning a minimal `SpokenSessionInput` built from
`DEFAULT_FOOL_VOICE_SETTINGS` in `@/common/types/foolVoice`, so the test breaks when the settings
shape changes rather than drifting from it.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bunx vitest run --maxWorkers=2 tests/unit/renderer/voice/spokenSession.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Model it on `runAgentTask.ts`'s `openTaskConversation`, which already resolves the pinned assistant
and model and handles the "nothing pinned" fallback. The differences, all deliberate:

```ts
// packages/desktop/src/renderer/services/voice/session/spokenSession.ts
const conversation = await ipcBridge.conversation.create.invoke({
  name: spokenConversationName(),
  ...(model ? { model } : {}),
  assistant: {
    id: assistant.id,
    locale: i18next.language || 'en-US',
    conversation_overrides: {
      model: overrideModelId,
      ...(unattended ? { permission: 'yolo' } : {}),
      ...(mcpIds.length > 0 ? { mcp_ids: mcpIds } : {}),
    },
  },
  // The persona, the memory, the taught skills and any rule set out loud, as
  // one document. `FoolrsBuildExtra.system_prompt` is read from here at session
  // build — see `fool-conversation/src/session_context.rs`.
  extra: {
    workspace: '',
    custom_workspace: false,
    system_prompt: buildPersonaInstructions({ ... }),
  },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run --maxWorkers=2 tests/unit/renderer/voice/spokenSession.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/services/voice/session/spokenSession.ts tests/unit/renderer/voice/spokenSession.test.ts
git commit -m "feat(voice): a spoken conversation the agent runtime owns"
```

---

### Task 2: Speech in, sentences out

**Files:**
- Create: `packages/desktop/src/renderer/services/voice/session/spokenTurn.ts`
- Create: `tests/unit/renderer/voice/spokenTurn.test.ts`

**Interfaces:**
- Consumes: `openSpokenSession` (Task 1), `conversation.sendMessage`, `conversation.responseStream`, `conversation.turnCompleted`.
- Produces: `runSpokenTurn(input: { conversationId: string; said: string; onSentence: (sentence: string) => void; signal?: AbortSignal }): Promise<{ ok: true; spoken: string } | { ok: false; reason: 'run-failed' | 'cancelled'; detail?: string }>`.

**The sentence split is not new code.** `localPipeline` already has the splitter that decides when
enough has arrived to be worth saying; this task moves the *source* of the text, not the rule for
cutting it. Extract the existing splitter into `common/voice/` first so both callers share one
definition and the old loop keeps working while the flag is off.

- [ ] **Step 1: Extract the splitter with its existing tests**

Move the sentence-boundary function out of `localPipeline.ts` into
`packages/desktop/src/common/voice/sentences.ts`, unchanged, and re-export it from the old site so
nothing else moves. Run the existing voice tests to prove nothing changed:

Run: `bunx vitest run --maxWorkers=2 tests/unit/voice tests/unit/renderer/voice`
Expected: PASS with the same counts as before the move.

- [ ] **Step 2: Write the failing turn test**

```ts
// tests/unit/renderer/voice/spokenTurn.test.ts
it('speaks each sentence as it arrives rather than at the end', async () => {
  const spoken: string[] = [];
  const turn = runSpokenTurn({ conversationId: 'c1', said: 'hello', onSentence: (s) => spoken.push(s) });
  emitStream({ type: 'content', data: 'Good ' });
  emitStream({ type: 'content', data: 'morning. ' });
  emitStream({ type: 'content', data: 'It is raining.' });
  emitStream({ type: 'finish' });
  await turn;
  expect(spoken).toEqual(['Good morning.', 'It is raining.']);
});

it('reports a run error rather than resolving silently', async () => {
  const turn = runSpokenTurn({ conversationId: 'c1', said: 'hello', onSentence: () => undefined });
  emitStream({ status: 'error', data: 'the model went away' });
  await expect(turn).resolves.toEqual(expect.objectContaining({ ok: false, reason: 'run-failed' }));
});
```

`emitStream` is a helper in the test that calls the registered `responseStream` listener with
`{ conversation_id: 'c1', position: 'left', ...message }`. Copy the listener-capturing mock shape from
`tests/unit/renderer/voice/runAgentTask.test.ts`, which already does exactly this.

- [ ] **Step 3: Run it to make sure it fails**

Run: `bunx vitest run --maxWorkers=2 tests/unit/renderer/voice/spokenTurn.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the turn**

Subscribe before sending, as `runAgentTask` does and for the same reason: a short turn can finish
before the listener would otherwise exist. Accumulate deltas, hand each completed sentence to
`onSentence`, and settle on `finish` or `turn.completed`. Ignore `position: 'right'` — that is the
request coming back on the same channel.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bunx vitest run --maxWorkers=2 tests/unit/renderer/voice/spokenTurn.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/common/voice/sentences.ts packages/desktop/src/renderer/services/voice/session/spokenTurn.ts tests/unit/renderer/voice/spokenTurn.test.ts packages/desktop/src/renderer/pages/voice/localPipeline.ts
git commit -m "feat(voice): a spoken turn that streams out of the agent runtime"
```

---

### Task 3: Barge-in cancels the turn

**Files:**
- Modify: `packages/desktop/src/renderer/services/voice/session/spokenTurn.ts`
- Modify: `tests/unit/renderer/voice/spokenTurn.test.ts`

**Interfaces:**
- Consumes: `conversation.stop`, `TConversationRuntimeSummary.turn_id`.
- Produces: `runSpokenTurn` honours `signal`, and cancelling stops the model as well as the speaker.

- [ ] **Step 1: Write the failing test**

```ts
it('stops the model, not just the speaker', async () => {
  const controller = new AbortController();
  const turn = runSpokenTurn({ conversationId: 'c1', said: 'hello', onSentence: () => undefined, signal: controller.signal });
  emitRuntime({ conversation_id: 'c1', turn_id: 'turn-9' });
  controller.abort();
  await expect(turn).resolves.toEqual(expect.objectContaining({ ok: false, reason: 'cancelled' }));
  expect(stop).toHaveBeenCalledWith({ conversation_id: 'c1', turn_id: 'turn-9' });
});

it('does not call stop when there is no turn to stop', async () => {
  const controller = new AbortController();
  const turn = runSpokenTurn({ conversationId: 'c1', said: 'hello', onSentence: () => undefined, signal: controller.signal });
  controller.abort();
  await turn;
  expect(stop).not.toHaveBeenCalled();
});
```

The second test matters more than the first. Cancelling a turn that never started would post a stop
for an empty `turn_id`, and the route would answer with an error the user hears as a failure for
something they never asked to fail.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bunx vitest run --maxWorkers=2 tests/unit/renderer/voice/spokenTurn.test.ts`
Expected: FAIL — stop is never called.

- [ ] **Step 3: Track the turn id and cancel with it**

Hold the latest `turn_id` seen for this conversation from the runtime summary. On abort, settle
`cancelled` immediately — the user must not wait for the network — and post the stop in the
background, ignoring its failure: the turn is already over from the user's side.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run --maxWorkers=2 tests/unit/renderer/voice/spokenTurn.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/services/voice/session/spokenTurn.ts tests/unit/renderer/voice/spokenTurn.test.ts
git commit -m "feat(voice): barge-in stops the model, not only the speaker"
```

---

### Task 4: A rule set out loud reaches the very next turn

**Files:**
- Create: `packages/desktop/src/common/voice/pendingInstructions.ts`
- Create: `tests/unit/voice/pendingInstructions.test.ts`
- Modify: `packages/desktop/src/renderer/services/voice/session/spokenTurn.ts`

**Interfaces:**
- Produces: `class PendingInstructions { add(instruction: string): void; takeForNextTurn(): string[]; }` and `prefaceWithInstructions(said: string, instructions: readonly string[]): string`.

- [ ] **Step 1: Write the failing test**

```ts
it('hands each instruction to exactly one turn', () => {
  const pending = new PendingInstructions();
  pending.add('Answer in English.');
  expect(pending.takeForNextTurn()).toEqual(['Answer in English.']);
  expect(pending.takeForNextTurn()).toEqual([]);
});

it('does not keep the same instruction twice', () => {
  const pending = new PendingInstructions();
  pending.add('Answer in English.');
  pending.add('answer in english.');
  expect(pending.takeForNextTurn()).toHaveLength(1);
});

it('puts the instruction ahead of what was said, marked as an instruction', () => {
  const message = prefaceWithInstructions('what is the weather', ['Answer in English.']);
  expect(message.indexOf('Answer in English.')).toBeLessThan(message.indexOf('what is the weather'));
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bunx vitest run --maxWorkers=2 tests/unit/voice/pendingInstructions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write it, and wire it into the turn**

A `foolrs` session builds its system prompt once, so a rule set out loud cannot be written into it.
It travels as the head of the next message instead. Wire `app_rule`, `app_remember` and `app_learn`
in `toolRunner.ts` to `add` when the spoken conversation is running on the agent runtime.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run --maxWorkers=2 tests/unit/voice/pendingInstructions.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/common/voice/pendingInstructions.ts tests/unit/voice/pendingInstructions.test.ts packages/desktop/src/renderer/services/voice/session/spokenTurn.ts
git commit -m "feat(voice): a rule set out loud binds the next turn"
```

---

### Task 5: The claim gate covers every surface

This is the task the whole sub-project exists to make possible. Until now
`common/voice/actionClaims.ts` has been imported by exactly one file.

**Files:**
- Create: `packages/desktop/src/renderer/services/voice/session/spokenOutput.ts`
- Create: `tests/unit/renderer/voice/spokenOutput.test.ts`
- Modify: `packages/desktop/src/renderer/pages/voice/runtime/conversationRuntime.ts`

**Interfaces:**
- Consumes: `findActionClaim` and the correction text from `@/common/voice/actionClaims`.
- Produces: `guardSpokenSentence(sentence: string, context: { toolsRan: number; memoryIsEmpty: boolean }): { speak: true } | { speak: false; correction: string }`.

- [ ] **Step 1: Write the failing test**

```ts
it('refuses a sentence claiming a completed action when no tool ran', () => {
  const verdict = guardSpokenSentence('Şimdi çalıyor.', { toolsRan: 0, memoryIsEmpty: false });
  expect(verdict.speak).toBe(false);
});

it('allows the same sentence when a tool did run', () => {
  expect(guardSpokenSentence('Şimdi çalıyor.', { toolsRan: 1, memoryIsEmpty: false }).speak).toBe(true);
});

it('refuses a claim to remember on an empty memory', () => {
  expect(guardSpokenSentence('Bunu hatırlıyorum.', { toolsRan: 0, memoryIsEmpty: true }).speak).toBe(false);
});
```

The Turkish sentence is deliberate: the first detector this project shipped was written against
`\b`, which is defined on ASCII and matched nothing in any locale the app speaks except English. A
test in the language the bug was reported in is the one that would have caught it.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bunx vitest run --maxWorkers=2 tests/unit/renderer/voice/spokenOutput.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the guard, and put every provider through it**

The gate sits in front of the speaker, not after the reply — a reply is spoken a sentence at a time
while the rest is still being written, so checking the finished text catches the lie only after the
user has heard it. Route the socket providers (`openai-realtime`, `gemini-live`, `local-s2s`) and the
new agent-backed path through this one function in `conversationRuntime`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run --maxWorkers=2 tests/unit/renderer/voice/`
Expected: PASS, including the existing action-claim tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/services/voice/session/spokenOutput.ts tests/unit/renderer/voice/spokenOutput.test.ts packages/desktop/src/renderer/pages/voice/runtime/conversationRuntime.ts
git commit -m "feat(voice): no surface can claim work it did not do"
```

---

### Task 6: The switch

**Files:**
- Modify: `packages/desktop/src/common/types/foolVoice.ts`
- Modify: `packages/desktop/src/renderer/pages/voice/runtime/conversationRuntime.ts`
- Create: `tests/unit/voice/spokenRuntimeChoice.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('keeps the old loop until the setting says otherwise', () => {
  expect(spokenRuntimeFor(DEFAULT_FOOL_VOICE_SETTINGS)).toBe('local-pipeline');
});

it('uses the agent runtime when the setting is on', () => {
  const settings = withAgentRuntime(DEFAULT_FOOL_VOICE_SETTINGS);
  expect(spokenRuntimeFor(settings)).toBe('agent');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bunx vitest run --maxWorkers=2 tests/unit/voice/spokenRuntimeChoice.test.ts`
Expected: FAIL — not defined.

- [ ] **Step 3: Add the setting, defaulting off**

A new client preference must be added to `configKeys.ts`, not only to `storage.ts`: the skill
catalogue test derives the app's key set from `ConfigKeyMap` and `ClientBusinessSettingMap`, and a key
added elsewhere reads as invented.

- [ ] **Step 4: Run the tests, then the whole voice suite**

Run: `bunx vitest run --maxWorkers=2 tests/unit/voice tests/unit/renderer/voice`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/common/types/foolVoice.ts packages/desktop/src/common/config/configKeys.ts packages/desktop/src/renderer/pages/voice/runtime/conversationRuntime.ts tests/unit/voice/spokenRuntimeChoice.test.ts
git commit -m "feat(voice): choose which runtime a spoken conversation uses"
```

---

### Task 7: The measurement gate

The flag does not open because the code works. It opens because the numbers hold.

**Files:**
- Create: `docs/specs/2026-08-09-spoken-turn-tasks.md`
- Modify: `docs/specs/2026-08-08-one-harness-measurements.md`

- [ ] **Step 1: Write the ten tasks down first**

Each is a sentence a user would actually say, with a plainly observable outcome. Written before the
run so the set cannot be chosen to flatter the result. Suggested, to be argued with: play a named
song; open a named site; look at the screen and answer a question about it; change the accent colour;
remember a fact and recall it in the next turn; teach a skill and use it; run a taught skill; ask for
something the app cannot do; interrupt mid-answer; ask two things in one breath.

- [ ] **Step 2: Record the before**

With the flag off, run the ten against `gemma-4-e4b` on the 8 GB card. Record per turn: rounds,
prompt tokens from the endpoint's own `usage`, milliseconds to first audio, total milliseconds, tool
calls, and whether the task completed.

- [ ] **Step 3: Record the after**

Flag on. Same ten, same machine, same model, same session length.

- [ ] **Step 4: Decide, and write the decision down**

The flag opens only if the median time to first audio is no worse than before, the round count has
not risen, and the completion rate has not fallen. If it regresses, the plan does not continue to
Task 8 — the regression is the next piece of work.

- [ ] **Step 5: Commit**

```bash
git add docs/specs/2026-08-09-spoken-turn-tasks.md docs/specs/2026-08-08-one-harness-measurements.md
git commit -m "docs: what a spoken turn costs, before and after"
```

---

### Task 8: Delete the old loop

Only after Task 7 opens the flag. A feature flag that never opens is a second harness with extra
steps, which is the thing this sub-project exists to remove.

**Files:**
- Modify: `packages/desktop/src/renderer/pages/voice/localPipeline.ts`
- Modify: `packages/desktop/src/renderer/pages/voice/runtime/conversationRuntime.ts`
- Modify: `packages/desktop/src/common/types/foolVoice.ts`

- [ ] **Step 1: Delete the turn loop, keep the sound**

What goes: the turn loop, the history, `MAX_TOOL_ROUNDS`, `MAX_HISTORY_TURNS`, the prompt assembly,
the summary call. What stays: audio capture, WAV conversion, the sentence queue, the look-ahead
renderer, the barge-in flush, and readiness detection.

- [ ] **Step 2: Remove the setting**

With one runtime there is nothing to choose. Removing the key needs the same care as adding it —
`configKeys.ts` as well as `storage.ts`.

- [ ] **Step 3: Run everything**

Run: `bunx vitest run --maxWorkers=2`
Expected: full count, exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src
git commit -m "refactor(voice): one harness, and the old loop is gone"
```

---

## What this plan does not do

- The permission layer, the sandbox choice and checkpoints. Next sub-project.
- `WebFetch`, `WebSearch`, background commands.
- Instant barge-in from a live phrase listener. This plan makes cancellation *possible* from outside
  the loop; making it *fast* is the spoken-experience sub-project.
- The stdio bridge that would let Claude Code and Codex reach the app's tools.
- `notifications/tools/list_changed`, so a session started before the renderer registers still sees
  no app tools.
