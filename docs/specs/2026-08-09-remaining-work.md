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

**Partly addressed, and only partly.** The gate now weighs tool *results* rather
than the number of calls: a result that says only `accepted` does not back a
completed-action claim (`backsCompletedAction`). That closes the hole delegation
would otherwise have opened. It does **not** answer the criticism below, which is
about how a claim is *detected* rather than about what backs it.

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

### 3.2 The release job has never built anything — **fixed**

This entry was wrong about the cause, so it is rewritten rather than ticked.
Releases *have* gone out — 2.3.4 to 2.3.10 are published, with `latest.yml` and
an installer on each. What had never happened is CI producing them: every `Build
and Release` run since 2.3.4 stopped at **Code Quality**, on **five oxlint
errors**, so `Build Pipeline` was skipped every time and the artefacts were
built by hand.

Fixed here. `Distribute Release Assets` was failing separately and for an
unrelated reason — it assumes an S3 mirror and this repository has no AWS
secrets — so it now says it is not configured and stops, instead of putting a
red cross on a release that is fine.

The console-teardown race this entry blamed was not observed: on Windows the
suite is green and exits 0. If it is real it is Linux-only, and the first CI run
that gets past Code Quality is the first evidence either way.

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

### 6.1 A delegated task that does not stop the conversation — **done**

Landed. `app_ask_jester` returns as soon as the task is accepted; the finish is
volunteered later, into the next gap that can take it. `runtime/delegatedTasks.ts`
holds the queue, `mayMentionAside` in `common/voice/thinkingAloud.ts` holds the
three refusals — over the answer, over the user, over the previous aside — and
the result is written into the conversation at the moment it is spoken, so "what
did it say?" has an answer.

One thing it opened, closed in the same change: the claim gate weighed the
*number* of tools that ran, so an accepted task would have backed "I've booked
your flight" with the booking still running. It now weighs results that report
completion — see `backsCompletedAction`.

The original entry, kept because the reasoning is still the reasoning:

**`app_ask_jester` used to be awaited inline**, so a spoken turn blocked for as
long as the agent ran. The filler lines cover the silence now, but the
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

- ~~**Switching the speaking model mid-conversation.**~~ **Done.** The id is read
  from the settings each turn and checked against what the server offers, so the
  change lands on the very next thing said. The spoken setting now matches
  against the server's own list — "gemma", "qwen", not the slug — and refuses a
  name nothing matches instead of confirming it.
- ~~**Being taken to the login when an agent needs one.**~~ **Done.** The setup
  panel starts the CLI's own sign-in in a visible terminal. The command is still
  there, and only appears once starting it has failed.
- **Faster first connection.** Nobody has measured where the time goes yet, so
  this is a measurement task before it is an optimisation task. **Still open.**
- ~~**Building an assistant or a persona in settings.**~~ **Done.** A library
  beside the instructions box: name what is in it, keep it, put it back on with
  a click or by saying its name. Applying one writes into the two fields
  everything downstream already reads, so it is a library rather than a fifth
  kind of persona.

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

---

## 8. What landed on 9 August, in the evening

Written after §7, and in the order it was built.

- **The release gate.** Five oxlint errors had stopped `Build and Release` at
  Code Quality since 2.3.4, so the build pipeline had never run for a tag. Four
  of the five were in tests: a Windows path written with one backslash, an
  optional chain the rule reads as unsafe, and three array snapshots it cannot
  tell from pointless ones. The two real snapshots are kept, named, with the
  reason written down.
- **A delegated task that does not stop the conversation** — §6.1, in full.
- **The claim gate weighs results rather than calls**, which is what makes the
  above safe to ship.
- **The model that answers, changed mid-conversation** — §6.6.
- **A login that opens instead of being described** — §6.6.
- **A library of personas the user writes** — §6.6.

### Still open, and why

- **§1.3 and §1.4** — the surfaces have not been moved onto `.fool-surface`, and
  the dial labels are not translated. Untouched here.
- **§2.1** — typed chat and the honesty gate. The decision named in that section
  has still not been made, and it is not a technical one.
- **§2.2** — the detector is still a verb list. What changed is what backs a
  claim, not how one is spotted.
- **§3.1** — blocked on a certificate, which is the user's to buy.
- **§4** — blocked on Docker, which is not on this machine.
- **§6.2, §6.3, §6.4, §6.5** — untouched. Note that `common/voice/spotifyPlayback.ts`
  already holds the part of §6.3 with no network in it.
- **Faster first connection** — a measurement task, not yet measured.
