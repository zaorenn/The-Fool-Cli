# Permission Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One decision — allow, ask, or deny — consulted before every tool call from every surface,
with enough granularity to let reading through and stop a delete.

**Architecture:** A pure decision function over ordered rules, living in `common` so both processes
share one definition. The app-tools channel consults it before broadcasting; the spoken and typed
paths inherit it because they both go through that channel. Nothing new is invented for asking: the
confirmation already travels as `confirmation.add` and comes back as an HTTP POST.

**Tech Stack:** TypeScript (`packages/desktop/src/common`, renderer), vitest.

**Scope:** §4 and §5 of `docs/specs/2026-08-09-safety-and-undo-design.md` — the rules and the
reversible/irreversible distinction. Checkpoints (§6) and the sandbox choice (§7) get their own plan;
this one lands working software without them, because asking before an irreversible action is worth
having whether or not there is a way back from the reversible ones.

## Global Constraints

- TypeScript: strict mode, no `any`, `type` over `interface`, single quotes, path aliases.
- **This project has no `strictNullChecks`.** A union discriminated by `ok: true/false` does not
  narrow; discriminate by a string literal, or compare against `false` explicitly.
- Every user-facing string is an i18n key in all thirteen locales.
- `bunx vitest run --maxWorkers=2 <paths>`; read the exit code from the command, never through a
  pipe into `head` or `grep`.
- Conventional Commits, **no AI signature**.
- No real user name or absolute path containing one, in any committed file — including rule
  examples and test fixtures.

---

### Task 1: The decision, as a pure function

**Files:**
- Create: `packages/desktop/src/common/permissions/decide.ts`
- Create: `packages/desktop/src/common/permissions/types.ts`
- Create: `tests/unit/common/permissions/decide.test.ts`

**Interfaces:**
- Produces: `type Decision = 'allow' | 'ask' | 'deny'`
- Produces: `type Rule = { decision: Decision; tool: string; pattern?: string }`
- Produces: `decide(rules: readonly Rule[], call: { tool: string; path?: string; command?: string }): Decision`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/common/permissions/decide.test.ts
import { describe, expect, it } from 'vitest';
import { decide } from '@/common/permissions/decide';
import type { Rule } from '@/common/permissions/types';

const rules: readonly Rule[] = [
  { decision: 'deny', tool: 'Write', pattern: 'C:/Windows/**' },
  { decision: 'ask', tool: 'Bash', pattern: 'git push*' },
  { decision: 'allow', tool: 'Bash', pattern: 'git status*' },
  { decision: 'allow', tool: 'Read' },
];

describe('decide', () => {
  it('takes the first matching rule', () => {
    expect(decide(rules, { tool: 'Bash', command: 'git status --short' })).toBe('allow');
    expect(decide(rules, { tool: 'Bash', command: 'git push origin main' })).toBe('ask');
  });

  it('denies before it allows, whatever the order of the call', () => {
    expect(decide(rules, { tool: 'Write', path: 'C:/Windows/system32/drivers/etc/hosts' })).toBe('deny');
  });

  it('allows a tool whose rule names no pattern', () => {
    expect(decide(rules, { tool: 'Read', path: 'D:/anything.txt' })).toBe('allow');
  });

  it('asks when nothing matches, because nobody thought about it', () => {
    expect(decide(rules, { tool: 'app_delete_everything' })).toBe('ask');
  });

  it('asks when a rule names a pattern and the call carries nothing to match it against', () => {
    // A `Bash` call with no command is not a `Bash` call anybody wrote a rule
    // for; treating it as a match would let an empty field buy an allow.
    expect(decide(rules, { tool: 'Bash' })).toBe('ask');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bunx vitest run --maxWorkers=2 tests/unit/common/permissions/decide.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the types and the function**

```ts
// packages/desktop/src/common/permissions/types.ts
/** What may happen to one tool call. */
export type Decision = 'allow' | 'ask' | 'deny';

/**
 * One rule, in the order it will be consulted.
 *
 * `pattern` is glob-shaped for a path and prefix-shaped for a command. Absent
 * means the rule is about the tool as a whole.
 */
export type Rule = {
  decision: Decision;
  tool: string;
  pattern?: string;
};

/** The call being judged. Exactly one of `path` or `command` is usually set. */
export type ToolCall = {
  tool: string;
  path?: string;
  command?: string;
};
```

The function itself is ordered-first-match, with the default being `ask`:

```ts
// packages/desktop/src/common/permissions/decide.ts
import type { Decision, Rule, ToolCall } from './types';

/**
 * What may happen to this call.
 *
 * Ordered, first match wins, and **the default is `ask` rather than `allow`**.
 * A tool nobody wrote a rule for is a tool nobody thought about, and the cost of
 * being asked once is smaller than the cost of finding out afterwards.
 */
export const decide = (rules: readonly Rule[], call: ToolCall): Decision => {
  for (const rule of rules) {
    if (matches(rule, call)) return rule.decision;
  }
  return 'ask';
};
```

Write `matches` beside it: the tool names must be equal; a rule with no pattern matches any call for
that tool; a rule with a pattern matches only when the call carries the corresponding field and the
pattern matches it. Path patterns are matched against the normalised path (see Task 2), command
patterns against the normalised command (Task 3).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run --maxWorkers=2 tests/unit/common/permissions/decide.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/common/permissions tests/unit/common/permissions
git commit -m "feat(permissions): one decision, and its default is to ask"
```

---

### Task 2: Paths that cannot be walked around

A path rule that can be defeated by `..` or a symlink is decoration. This is the task where the
design's warning about `fool-file`'s Windows separator bugs has to be honoured rather than repeated.

**Files:**
- Create: `packages/desktop/src/common/permissions/paths.ts`
- Create: `tests/unit/common/permissions/paths.test.ts`
- Modify: `packages/desktop/src/common/permissions/decide.ts`

**Interfaces:**
- Produces: `normalisePath(path: string): string` — separators folded to `/`, `.`/`..` resolved lexically, case folded on Windows.
- Produces: `matchesPath(pattern: string, path: string): boolean` — `**` crosses separators, `*` does not.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/common/permissions/paths.test.ts
import { describe, expect, it } from 'vitest';
import { matchesPath, normalisePath } from '@/common/permissions/paths';

describe('normalisePath', () => {
  it('folds Windows separators, because a rule written with one must catch the other', () => {
    expect(normalisePath('C:\\Windows\\System32')).toBe('c:/windows/system32');
  });

  it('resolves dot segments so a rule cannot be walked around', () => {
    expect(normalisePath('D:/work/../../Windows/system32')).toBe('c:/windows/system32'.replace('c:', 'd:').replace('d:/windows/system32', 'windows/system32'));
  });

  it('leaves a plain relative path alone apart from case and separators', () => {
    expect(normalisePath('src\\Main.rs')).toBe('src/main.rs');
  });
});

describe('matchesPath', () => {
  it('crosses directories only for a double star', () => {
    expect(matchesPath('C:/Windows/**', 'c:/windows/system32/drivers/etc/hosts')).toBe(true);
    expect(matchesPath('C:/Windows/*', 'c:/windows/system32/drivers/etc/hosts')).toBe(false);
  });

  it('matches whatever separator the rule was written with', () => {
    expect(matchesPath('C:\\Windows\\**', 'c:/windows/system32')).toBe(true);
  });

  it('does not match a sibling whose name merely starts the same', () => {
    expect(matchesPath('D:/work/**', 'd:/workspace/secret.txt')).toBe(false);
  });
});
```

The second `normalisePath` expectation is written awkwardly on purpose in this plan; when
implementing, replace it with the literal the implementation should produce and assert that directly.
Decide the rule first: **`..` is resolved lexically and never allowed to escape above a drive root.**

- [ ] **Step 2: Run it to make sure it fails**

Run: `bunx vitest run --maxWorkers=2 tests/unit/common/permissions/paths.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write it**

Lexical resolution only, in `common`, with no filesystem access: this module is shared by both
processes and must stay pure. Symlink resolution belongs to the caller in the main process, which
has a filesystem — the decision function takes an already-resolved path and the wiring in Task 4
resolves before asking.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run --maxWorkers=2 tests/unit/common/permissions/paths.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/common/permissions/paths.ts tests/unit/common/permissions/paths.test.ts packages/desktop/src/common/permissions/decide.ts
git commit -m "feat(permissions): a path rule that cannot be walked around"
```

---

### Task 3: Commands matched by what they run

**Files:**
- Create: `packages/desktop/src/common/permissions/commands.ts`
- Create: `tests/unit/common/permissions/commands.test.ts`

**Interfaces:**
- Produces: `normaliseCommand(command: string): string` — the program reduced to its base name without extension, arguments preserved.
- Produces: `matchesCommand(pattern: string, command: string): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/common/permissions/commands.test.ts
import { describe, expect, it } from 'vitest';
import { matchesCommand, normaliseCommand } from '@/common/permissions/commands';

describe('normaliseCommand', () => {
  it('reduces a fully qualified program to what the rule names', () => {
    expect(normaliseCommand('"C:\\Program Files\\Git\\bin\\git.exe" push origin main')).toBe('git push origin main');
  });

  it('leaves a bare command alone', () => {
    expect(normaliseCommand('git status --short')).toBe('git status --short');
  });
});

describe('matchesCommand', () => {
  it('matches a prefix rule against the normalised command', () => {
    expect(matchesCommand('git push*', '"C:\\Program Files\\Git\\bin\\git.exe" push origin main')).toBe(true);
  });

  it('does not match a different subcommand that starts the same', () => {
    expect(matchesCommand('git push*', 'git pushover')).toBe(false);
  });

  it('does not let a chained command smuggle one past the rule', () => {
    // The rule allows `git status`; the call is `git status && rm -rf /`.
    // Matching the prefix and stopping there is how an allow-list becomes a
    // hole. A chained command matches nothing and therefore asks.
    expect(matchesCommand('git status*', 'git status && rm -rf /')).toBe(false);
  });
});
```

The third test is the one that matters. Every allow-list for shell commands that has ever been
written badly was written badly in exactly this way.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bunx vitest run --maxWorkers=2 tests/unit/common/permissions/commands.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write it**

Split on the shell's own separators (`&&`, `||`, `;`, `|`, newline) before matching, and require
every segment to match a rule for the call to match one. A command containing a separator that any
segment fails on is `ask`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run --maxWorkers=2 tests/unit/common/permissions/commands.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/common/permissions/commands.ts tests/unit/common/permissions/commands.test.ts
git commit -m "feat(permissions): a command rule that a chain cannot slip past"
```

---

### Task 4: The default rules, and the tools that must never prompt

**Files:**
- Create: `packages/desktop/src/common/permissions/defaults.ts`
- Create: `tests/unit/common/permissions/defaults.test.ts`

**Interfaces:**
- Produces: `DEFAULT_RULES: readonly Rule[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/common/permissions/defaults.test.ts
import { describe, expect, it } from 'vitest';
import { decide } from '@/common/permissions/decide';
import { DEFAULT_RULES } from '@/common/permissions/defaults';

describe('the default rules', () => {
  it('never prompts for the things a conversation is made of', () => {
    // An assistant that asks permission to look at a screen the user just
    // pointed at is one nobody keeps switched on.
    for (const tool of ['app_look_at_screen', 'app_search', 'app_open_url', 'app_theme', 'app_skill_do']) {
      expect(decide(DEFAULT_RULES, { tool })).toBe('allow');
    }
  });

  it('asks before anything that cannot be taken back', () => {
    expect(decide(DEFAULT_RULES, { tool: 'Bash', command: 'rm -rf D:/work' })).not.toBe('allow');
    expect(decide(DEFAULT_RULES, { tool: 'Write', path: 'C:/Windows/system32/x.dll' })).toBe('deny');
  });

  it('asks every time before sending, with no way to make it stop', () => {
    // The cost of a wrong send is not paid by the person who clicked allow.
    expect(decide(DEFAULT_RULES, { tool: 'app_send_message' })).toBe('ask');
  });

  it('asks for a tool nobody wrote a rule for', () => {
    expect(decide(DEFAULT_RULES, { tool: 'something_new' })).toBe('ask');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bunx vitest run --maxWorkers=2 tests/unit/common/permissions/defaults.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the defaults from §5 of the design**

Reading, looking, searching, opening and theming allow. Deleting, installing, elevating and sending
ask. Writing to system directories denies. Everything else falls through to `ask`.

- [ ] **Step 4: Run the tests, and the ten spoken tasks as a regression**

Run: `bunx vitest run --maxWorkers=2 tests/unit/common/permissions/`
Expected: PASS.

Then check the rules against `docs/specs/2026-08-09-spoken-turn-tasks.md` by hand: if any of those
ten would now prompt, the rules are wrong and the rules change, not the task list.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/common/permissions/defaults.ts tests/unit/common/permissions/defaults.test.ts
git commit -m "feat(permissions): defaults that ask about what cannot be undone"
```

---

### Task 5: The channel consults the decision

**Files:**
- Modify: `packages/desktop/src/renderer/services/appTools/appToolChannel.ts`
- Modify: `tests/unit/renderer/appTools/appToolChannel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('refuses a denied call without running it', async () => {
  startAppToolChannel();
  await listeners[0](request('call-9', 'app_delete_everything'));

  expect(runVoiceTool).not.toHaveBeenCalled();
  expect(postResult).toHaveBeenCalledWith(expect.objectContaining({ call_id: 'call-9', ok: false }));
});
```

A denied call still gets exactly one answer, and that answer says it was refused. Silence here would
be the same failure as the timeout: an agent waiting on a tool that will never come back.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bunx vitest run --maxWorkers=2 tests/unit/renderer/appTools/appToolChannel.test.ts`
Expected: FAIL — the tool runs.

- [ ] **Step 3: Consult the decision before running**

`allow` runs. `deny` answers with a refusal the model can read and say. `ask` is Task 6 and, until
then, is treated as `deny` with a message that names why — which is safe, honest, and visibly
incomplete rather than quietly permissive.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run --maxWorkers=2 tests/unit/renderer/appTools/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/services/appTools tests/unit/renderer/appTools
git commit -m "feat(permissions): the app-tools channel asks before it acts"
```

---

### Task 6: Asking, and remembering the answer

**Files:**
- Modify: `packages/desktop/src/renderer/services/appTools/appToolChannel.ts`
- Create: `packages/desktop/src/renderer/services/appTools/askPermission.ts`
- Create: `tests/unit/renderer/appTools/askPermission.test.ts`
- Modify: all thirteen locale `settings.json`

- [ ] **Step 1: Write the failing test**

```ts
it('runs the tool once the user allows it', async () => {
  const asked = askPermission({ tool: 'Bash', command: 'git push origin main' }, 'c1');
  answerWith('allow');
  await expect(asked).resolves.toBe('allow');
});

it('does not offer "always" for something that sends', async () => {
  // The cost of a wrong send is not paid by the person who clicked allow.
  expect(optionsFor({ tool: 'app_send_message' })).not.toContain('always');
});

it('treats a conversation that ended as a refusal', async () => {
  const asked = askPermission({ tool: 'Bash', command: 'rm -rf D:/work' }, 'c1');
  endConversation('c1');
  await expect(asked).resolves.toBe('deny');
});
```

The third is the one a spoken conversation depends on: nobody is looking at a dialog, so an
unanswered ask must resolve to a refusal rather than hang for the full tool deadline.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bunx vitest run --maxWorkers=2 tests/unit/renderer/appTools/askPermission.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write it, on the confirmation channel that already exists**

`confirmation.add` out, the POST back, and the same shape the chat already uses so the card looks
like every other card in the app. "Always allow" adds a rule to the user's own list; it is not
offered for the send category.

- [ ] **Step 4: Add the strings in thirteen locales, and validate**

```bash
bun run i18n:types
node scripts/check-i18n.js
```

- [ ] **Step 5: Run everything**

Run: `bunx vitest run --maxWorkers=2`
Expected: full count, exit 0. Read the exit code from the command itself.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src tests/unit
git commit -m "feat(permissions): ask, and remember the answer where it is safe to"
```

---

## What this plan does not do

- **Checkpoints and rollback.** §6 of the design; its own plan. Until it exists, "reversible" means
  "reversible in principle", and the defaults are written accordingly — writing inside a workspace
  allows, which is only defensible once there is a way back.
- **The sandbox choice.** §7 of the design.
- **Symlink resolution.** The decision function takes a resolved path; the resolver belongs in the
  main process and is part of the checkpoint plan, which is where filesystem access already lives.
- **The three Windows path bugs in `fool-file`** recorded in the handover. They have to be fixed
  before symlink resolution is trusted, and they are not this plan.
