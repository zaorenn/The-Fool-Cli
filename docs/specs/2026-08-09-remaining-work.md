# What is left

**Date:** 2026-08-09
**Branch:** `feat/one-harness`
**Scope:** only the work that is _not_ done. What shipped is in the commit log
and in `docs/HANDOVER.md`; this file exists so the next session does not have to
re-derive the list.

Ordered by what blocks the most. Every item says what "done" means, so nobody
has to guess whether they finished it.

---

## 1. The appearance studio — four slices left

The foundation landed and is tested. What is left is the surface area that
touches it.

**Done already, so build on it rather than beside it:**

| Piece                                                         | Where                                                                            |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| The seven materials, the dials, the derived palette           | `packages/desktop/src/common/theme/surfaceStyle.ts`                              |
| What gets stored (a material, a colour, only the moved dials) | `packages/desktop/src/common/theme/surfaceChoice.ts`                             |
| "Make it calmer" as an intent, shared by every caller         | `packages/desktop/src/common/theme/surfaceIntent.ts`                             |
| The rules the material selects                                | `packages/desktop/src/renderer/styles/materials.css`                             |
| The store, applied live and across windows                    | `packages/desktop/src/renderer/hooks/config/useSurfaceStyle.ts`                  |
| `app_theme` actions `style` and `dial`                        | `packages/desktop/src/common/realtime/index.ts`, `…/voice/runtime/toolRunner.ts` |

The design this is built to match is the artifact published on 9 August: seven
materials, a colour picker that derives the whole palette, twenty-five dials in
seven collapsible groups, a three-step first-run wizard, and a sentence box.

### 1.1 The settings panel — `Settings → Appearance`

**Where:** `packages/desktop/src/renderer/pages/settings/AppearanceSettings/`.
There is already a `ThemeCustomizer.tsx` and a `layout/` directory with a
`TokenEditor.tsx`; this is a third section beside them, not a replacement.

**What it needs:** the material picker (seven cards, each showing its own
material in miniature — the swatch _is_ the explanation for somebody who has
never heard the word), an `<input type="color">` whose derived ramp is shown
beside it, and the dials grouped into collapsible sections. Every control writes
through `useSurfaceStyle`; none of them writes CSS directly.

**Done when:** changing anything is visible immediately in every open window,
the panel survives a restart, and `Reset` returns to what the app ships with.

**Watch for:** the panel previews onto its own element via `applySurfaceChoice(choice, element)`
rather than onto the document, so the rest of the app does not change under
somebody who is still deciding.

### 1.2 The first-run wizard

**Where:** `packages/desktop/src/renderer/pages/welcome/`.

Three steps: connect an agent (the page already probes for what is installed —
`welcomeModel.ts`), choose a material, choose a colour. The artifact's version
counts clicks and shows the total, which is worth keeping: the promise is that
somebody is set up and using it in about ten.

**Done when:** a fresh profile reaches a working, chosen-looking app without
opening settings once, and "Skip" leaves the app on its defaults rather than
half-configured.

### 1.3 Move the surfaces onto `.fool-surface`

The stylesheet is inert until components carry the class. In rough order of how
much each is looked at:

1. Voice (`pages/voice/`) — the notch is the most characteristic surface in the app.
2. Chat (`pages/conversation/`) — message bubbles and the composer.
3. Hub (`pages/hub/`) — workspace cards.
4. Settings (`pages/settings/`) — the sider and each tab's panels.
5. Team (`pages/team/`), Cron, Welcome.

**Done when:** switching material visibly changes each page, and no page has a
hard-coded shadow or radius left that ignores the setting. A page that only
half-follows is worse than one that does not follow at all — it reads as a bug.

**Watch for:** Arco components. `arco-override.css` and the `:global()` pattern
in CSS Modules are how the existing code reaches them; the material variables
are readable from there.

### 1.4 The panel's own words, in thirteen languages

`settings.appearance.material.*` exists in all thirteen already (it is what the
spoken reply uses). The dial labels and hints do not. Follow the `i18n` skill;
run `bun run i18n:types` and `node scripts/check-i18n.js`.

---

## 2. The two criticisms still open

From the review the branch was built against. Six of eight closed; these two did
not.

### 2.1 Typed chat does not go through the honesty gate

`actionClaims.ts` is imported from exactly two files, both spoken
(`localPipeline.ts`, `spokenOutput.ts`). All four _voice_ surfaces are covered.
Typed chat is not, and the documentation describes the guarantee as the
product's.

**The decision that has to be made first, and it is not a technical one:** in
typed chat the evidence is on screen — the user can see that no tool ran. Is the
right answer to _gate_ the message (re-prompt, as the voice path does), to _mark_
it ("no tool ran this turn"), or to state the scope honestly and stop calling it
a product-wide guarantee? Gating a chat window is intrusive and will fire on a
model quoting the user or writing code that contains "I created the file".

**Do not start this without answering that.**

### 2.2 The claim detector is a verb list

It catches a completed-action claim by matching conjugations, per language. Two
holes were found by hand in one session (`aldım` missing from Turkish; a `\w`
written with one backslash). The structural answer is either a small classifier
call or requiring a claim to name the tool result behind it. Adding verbs is not
a fix, and it should not be presented as one.

---

## 3. Product and distribution

### 3.1 The installer is unsigned

Nothing in `packages/desktop/electron-builder.yml` signs anything; `afterSign.js`
is macOS notarization and returns immediately on Windows. Since 2023 the private
key must live on FIPS hardware or in a cloud signing service, so a `.pfx` in the
repo is not an option.

**Blocked on the certificate**, which is the user's to buy. For an individual in
Turkey the practical route is SSL.com (OV, or EV if the SmartScreen warning has
to disappear immediately); Azure Trusted Signing is cheaper but individual
sign-up is USA/Canada only.

**When it arrives:** add `win.signtoolOptions` (electron-builder 26 moved the
keys under it), and verify the artefact with `signtool verify /pa` — the
builder's own log line is not evidence of a signature.

### 3.2 No release has gone out since 2.2.52

A green suite exits non-zero on Linux CI (a console-teardown race), which blocks
the release job. Auto-update also needs a _published_ release with `latest.yml`
uploaded — a draft is invisible to the updater.

### 3.3 The other two, untouched

330 MB installer. No telemetry, which is why the "50 kbps download" report has
been undiagnosable for weeks.

---

## 4. Benchmarks

`bench/` holds a Dockerfile and the container contract. `bench/README.md` is the
authority on what is missing; the short version:

- **No Docker on the development machine.** The image has never been built.
- **No Harbor adapter.** It is ~40 lines of Python and must be written against
  `AbstractInstalledAgent` as it actually is, not as it is remembered.
- **No published Linux build**, so a harness on Linux builds from source.

The order is: build the image → run one task by hand → write the adapter → run
ten → fix what the failures show → only then run the full set and publish a
number with the command beside it.

**Nothing goes in the top-level README until step 4.**

---

## 5. Known limitations, recorded rather than fixed

These are deliberate. Do not "discover" them again.

- **A rename in a watched folder is reported as a delete and a create on
  Windows.** `local_provider::inode_of` returns 0 there because the file id
  Windows has is only reachable through an open handle, and opening one per
  entry would cost a handle on every file of every listing. The fix belongs in
  the reconcile step, resolving identity for the removed/added pairs alone.
  Asserted as-is in `tree_model_test.rs`.
- **Three tests are `#[cfg(unix)]`** because they need a fake `node` that runs
  and prints a version, and the Windows layout wants that to be `node.exe` — a
  real PE a test cannot write. Windows path resolution is covered; its execution
  is not.
- **The eval runner needs a model endpoint.** `bun scripts/eval/run.ts` exits 2
  with an explanation rather than reporting a score of zero, which would look
  like a regression.

---

## Verification state, so nobody claims more than was checked

- Rust core workspace: **green** on Windows after the twelve platform fixes.
  Last full run had two failures, both since fixed and re-run individually.
- TypeScript: `bunx tsc --noEmit` clean.
- The appearance foundation: 49 tests across `tests/unit/theme/`.
- **Not verified by running the app.** The spoken runtime default was flipped on
  and the material layer landed without `bun run dev` being driven by hand —
  there is no model server on the machine this was written on. The user has
  tested the spoken runtime before, with the flag on, and reported it working.

---

## 6. Asked for on 9 August, after this file was first written

In the order they should be built, which is not the order they were asked in:
each one below depends on the ones above it.

### 6.1 A delegated task that does not stop the conversation

**Today `app_ask_jester` is awaited inline**, so a spoken turn blocks for as
long as the agent runs. The filler lines cover the silence now, but the
conversation still cannot go anywhere else while it waits.

What it should be: the tool returns as soon as the task is _accepted_, the
conversation carries on, and the finish arrives later as an interruption the
assistant volunteers — "bu arada, o iş bitti". The lines for that already
exist, in thirteen languages, at `settings.voice.thinkingAloud.aside.*`; what
does not exist is the channel that delivers the completion to a turn that has
already ended.

**Watch for:** two tasks finishing while a third is being discussed, and a task
finishing while the user is mid-sentence. Neither may talk over them.

### 6.2 Permissions for an outside account, before any outside account

Mail that can be read and not written is a _permission model_, and it has to
exist before the first connector, or the first connector defines it by
accident. `common/permissions/` already holds the rule engine for tools; this
is the same idea one level out: per connected service, per capability, with
read and write as separate answers.

**Done when:** a connector declares the capabilities it wants, the user grants
them one at a time in settings, and a tool call that exceeds what was granted
is refused by the layer rather than by the connector's own good manners.

### 6.3 Spotify, then mail

Both are OAuth, both are `.env`-free (the token belongs to the user, not the
build), and both should arrive as connectors over the permission model above
rather than as bespoke code in the voice runtime. Spotify first: it is the
smaller surface, and "favori şarkımı aç" already exists as a taught skill that
opens a URL — replacing that with a real player is a visible win on day one.

### 6.4 An artifact system, and models that can use it

Claude's shape: a model writes a self-contained page, it renders beside the
conversation, and it can be revised in place rather than re-pasted. The
application already has most of the parts — `app_build_app` writes and previews
a page, and the Hub keeps built workspaces — so this is mostly about giving
them one identity: an artifact that is addressable, versioned, and offered to
every agent as a tool rather than only to the spoken one.

### 6.5 Extensions, last

Deliberately last, and the reason is worth keeping: an extension system built
before the permission model and the connector shape would freeze both. There is
already a `fool-extension` crate and a settings page for it; what is missing is
the contract a third party writes against.

### 6.6 The smaller ones, unblocked

- **Switching the speaking model mid-conversation**, the way the theme can be
  changed mid-conversation now. `app_settings` already reaches voice settings;
  the work is making the running session pick up a change rather than needing a
  restart.
- **Being taken to the login when an agent needs one.** Connecting Claude Code
  should open the flow, not print an instruction.
- **Faster first connection.** Nobody has measured where the time goes yet, so
  this is a measurement task before it is an optimisation task.
- **Building an assistant or a persona in settings.** The presets exist in
  `common/realtime/personas.ts`; what does not is a way for the user to add one.

---

## 7. What landed on 9 August, so nobody rebuilds it

- The spoken register: a turn that did work says what it did rather than
  reading out its diff (`common/voice/spokenRegister.ts`).
- Filling a silence: "hmm, bir bakayım" into a gap, gaps that double, three
  variants per kind, thirteen languages (`common/voice/thinkingAloud.ts`).
- The material layer, its panel, the first-run wizard, and `app_theme` gaining
  `style` and `dial` — see §1, which is now mostly done rather than mostly not.

### Measured, for the first time

`bun scripts/eval/run.ts`, on this machine, 9 August:

| Model                | Score                                             |
| -------------------- | ------------------------------------------------- |
| `qwen/qwen3.5-9b`    | **8/8**                                           |
| `google/gemma-4-e4b` | **7/8** — missed teaching a skill, called no tool |

Suites at that point: TypeScript 4,931 passed / 0 failed; Rust core 5,394
passed / 0 failed; `tsc --noEmit` clean.
