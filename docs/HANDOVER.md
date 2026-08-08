# Handover — 2.3.9 is out, and one harness has started

## The branch in progress: `feat/one-harness`

Branched from `main` in `C:/Fool-AionUI`. **Not released, not merged, not pushed.** The version on
`main` is still 2.3.10 and nothing a user can install has changed.

This is the first of eight sub-projects agreed after an honest read of the competition. The design is
`docs/specs/2026-08-08-one-harness-design.md`, the plan is `…-plan.md`, and the numbers so far are in
`…-measurements.md`. The other seven, in order, are listed in §11 of the design.

**What it does.** The application's own capabilities — looking at the screen, the theme, the
settings, the memory, the taught skills — are now MCP tools any agent can call. A call arrives at an
in-process MCP server, is broadcast to the renderer, runs through the existing `runVoiceTool`
handler, and the answer comes back over HTTP. It is a second instance of the pattern `fool-team`
already uses, which is why the risk was low and the generic half (`fool-mcp-server`) was extracted
rather than written twice.

**What it does not do yet.** Nothing here decides whether a tool is *allowed* to run. And a hosted CLI
agent (Claude Code, Codex) cannot reach the server yet — that needs the stdio bridge subcommand, so
the design's claim that typed chat gains these tools "for free" is true of the embedded agent only,
today.

## The spoken turn has moved, behind a flag that is shut

The second half — `docs/specs/2026-08-09-spoken-turn-on-foolrs-plan.md`, tasks 1 to 6 of 8. With
`realtime.useAgentRuntime` on, a spoken conversation opens an ordinary agent conversation carrying
the persona, memory and taught skills as its system prompt, streams the answer back sentence by
sentence, and cancels the model — not just the speaker — when the user talks over it.
`localPipeline` keeps the microphone, the sentence queue and the barge-in flush; what it no longer
does, in that mode, is think.

Three things in it are worth knowing rather than rediscovering:

- **A rule set out loud can no longer be written into the system prompt**, because an agent session
  builds one once. It rides ahead of the next message instead
  (`common/voice/pendingInstructions.ts`). Agreeing to a rule and then ignoring it until next session
  would be the failure the old code existed to prevent.
- **The claim gate is now one function** (`renderer/services/voice/session/spokenOutput.ts`) and every
  surface passes through it: the agent path refuses a sentence *before* it is queued and hands the
  model back its own words for exactly one more round; the socket providers, which speak their own
  audio, get the rest of the claim flushed and keep it out of the record. That is weaker for
  speech-to-speech and it is weaker on purpose — it is the most that can be done when the audio is
  already leaving the speaker.
- **The flag is off**, and it stays off until the numbers in
  `docs/specs/2026-08-09-spoken-turn-tasks.md` are taken.

**Tasks 7 and 8 cannot be finished without you.** Task 7 is the measurement, and it needs LM Studio
up with `gemma-4-e4b` (the endpoint was not answering on 9 August) and a person to speak the ten
sentences — time to first audio cannot be recorded from a script, and nobody should pretend
otherwise. Task 8 deletes the renderer's loop and is gated on Task 7 passing; deleting it first
would be exactly the recklessness the gate exists to prevent.

**The Rust suite is not a usable feedback loop, and this is a finding rather than an aside.**
`cargo test --workspace` builds and links **171 separate test binaries**, most of which boot a whole
application. On this machine it ran for over an hour and had reached 78 of them. Nothing was wrong —
it was grinding, not stuck — but a suite nobody can afford to run is a suite that stops being run,
and this project already has one test-count problem (see the vitest note further down). There is no
recorded baseline for how long it should take. Both belong to the product sub-project, and the
figure to beat is the one above.

`capability::cli_process::tests::spawn_allows_cwd_with_whitespace_in_any_segment` and its `_for_sdk`
twin **fail under load and pass in isolation**: `taskkill` races the child, which has already exited,
and the error is Windows saying there is no such task. Seen three times on 8 August. Do not go
looking for a real bug there.

**Three Rust tests genuinely fail on Windows, on a clean tree.** A full run reported 6186 passed and
37 failed; 34 of those passed when their crates were run alone, and three did not. They are
reproducible, they are nothing to do with the branch — `git diff main...HEAD` touches neither crate —
and they are all one shape: paths.

| Test                                                            | What it says                                              |
| --------------------------------------------------------------- | ----------------------------------------------------------- |
| `fool-file` `service::tests::build_dir_tree_sync_relative_paths` | got `folder\file.txt`, wanted `folder/file.txt`           |
| `fool-file` `service::tests::list_workspace_files_sync_relative_paths` | got `src\main.rs`, wanted `src/main.rs`             |
| `fool-conversation` `create_rejects_unavailable_workspace_with_trailing_whitespace_in_request` | a trailing-space workspace is accepted here, not rejected |

Either the code should normalise separators and Windows was never checked, or the tests were written
on a machine where `/` is the only separator. Somebody has to decide which; until then a green Rust
run is not achievable on this machine and "the suite passes" is not a claim anyone can make.

**Two known gaps, written down rather than discovered later.**

- **A session started before the renderer registers sees no app tools, permanently.** An MCP client
  calls `tools/list` once. The catalogue is re-declared on `realtime.reconnected`, which covers a
  backend restart, but a session created in that first moment never asks again. The fix is
  `notifications/tools/list_changed`; it is not written.
- **The two refusal sentences a model may repeat are English** (`fool-app-tools/src/host.rs`). Every
  locale relies on the model translating them.

---

## The released state

Written 8 August 2026. `main` in `C:/Fool-AionUI` at `f3af355e4`, version 2.3.9, tree clean,
pushed. **[v2.3.9](https://github.com/zaorenn/The-Fool-Cli/releases/tag/v2.3.9) is published**,
non-draft, both assets uploaded, live feed answers with it. **Nothing is sitting unreleased.**

Seven releases went out in one session, 2.3.4 through 2.3.9. What each contains, verified by
`git merge-base --is-ancestor` rather than from memory:

| In    | From                                                                                        |
| ----- | ------------------------------------------------------------------------------------------- |
| 2.3.8 | the guard that stops it claiming work it did not do (`b6a92afd5`, `1da098c0e`, `6ef2bbaff`) |
| 2.3.9 | idle VRAM release, local-model advice, one-step agent connection                            |

Read `docs/ROADMAP.md` next. It holds an honest read of the competition and eight prompts to
hand back, in the order that makes the later ones measurable rather than hopeful.

---

## The release, and how it was checked

Nothing here was taken on trust from an exit code, because on this project an exit code has
lied twice.

| Checked                      | Result                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Installer on disk            | `out/TheFool-2.3.7-win-x64.exe`, 330,037,030 bytes, built 18:54                                                     |
| `latest.yml` vs the file     | SHA-512 recomputed from the bytes on disk; identical                                                                |
| The feed the updater fetches | `releases/latest/download/latest.yml` → **HTTP 200**, version 2.3.7, matching hash                                  |
| Release state                | `draft=false  prerelease=false`, both assets `uploaded`                                                             |
| Staged `foolcore`            | rebuilt; no `VCRUNTIME140` import, no build-machine username, and the new catalogue row genuinely inside the binary |
| Packaged `CHANGELOG.md`      | present in `resources/`, opening on the 2.3.9 section                                                               |
| Test suite                   | **4649 passed, 3 skipped, exit 0** — twice, once directly and once inside `just push`                               |

The installer is **unsigned**. electron-builder prints `signing with signtool.exe` for every
executable it touches and then prints `NOT signed (NotSigned)` at the end; the second line is
the true one. SmartScreen warns on any machine that has not seen the build, and the release
notes say so.

## What shipped in 2.3.5 and 2.3.6

### Spoken conversations, kept — `0e129e661`

A spoken conversation left one summarised line in the memory and nothing else. Every launch
opened onto an empty page; there was no way to read back what had been said, and no way to
pick a thread up again.

Three decisions worth understanding rather than just knowing about:

**Turns are written as they are said, not at teardown.** A spoken conversation is far more
often ended by the window going away than by anybody pressing stop, so a transcript assembled
at the end is a transcript that usually does not exist. What survives a crash is everything up
to the crash. The hook is the runtime's `record`, which is the one point both transports pass
through — the local pipeline keeps its own history to think with, the socket providers keep
theirs on the far side of a socket, and neither survives a restart.

**Resuming opens a new conversation carrying the tail of the old one**, rather than appending
to it. The old conversation happened; rewriting it days later would make the list lie about
when things were said. The tail rather than the whole thing because it becomes prompt, and it
is labelled as already said so the model does not answer a question from yesterday.

**Its own stored key, `fool.voice.conversations`.** The memory is a short document changed when
something is learned; this grows by a line whenever anyone speaks. Sharing one record would
have every sentence rewrite the memory document, and one failed write lose both.

### A skill it can see but has no address for — `adb7e804f`

The schema does not require an address, because the name and the trigger arrive a turn before
one does. The handler answered that case with the generic "not something the voice can do", so
the model read it as the tool being broken and fell back to asking the user to describe the
steps by hand. Underneath was a real gap: looking at the screen gives a title, never an
address — the browser sits behind our own window and its address bar is not in the picture.
`app_find_video` resolves a title to a real watch address without opening anything, and the
model is told to offer what it found and wait for a yes before saving, because it is a guess
from a title.

### A card full of voices nobody chose — `90b97bb67`

The audio.cpp server was handed _every_ installed model, and it loads every entry it is given
and holds those weights for the life of the process. Four downloaded voices meant four
resident at once, and choosing a different one released nothing, because the config had not
changed and so the child was never replaced. The config carries one model now, which puts it in
the runtime signature and makes a voice change a teardown. Switching to a different engine
shuts it down entirely.

### Download measurement — `9b55c012d`

See the open item below; this is the instrumentation, not a fix.

---

## What shipped in 2.3.6, and the principle behind it

Three fixes to one failure: the assistant saying a thing had happened when it had not.

**The rule was already there and did not hold.** `TOOL_RULES` has carried 'never say you
have done something unless a tool told you it was done' — named as the most damaging thing
it can do — for as long as the persona has existed. It was still watched saying "Şimdi
çalıyor" with an empty activity list. **Do not answer this class of bug with another rule.**
A model that has decided it finished a task will say so in whatever words the prompt has not
forbidden. The fix has to be mechanical.

- `b6a92afd5` — a sentence claiming a completed action, on a turn where no tool ran, is never
  queued for the speaker. The gate is **before** the speaker, not after the reply: a reply is
  said a sentence at a time while the rest is still being written, so checking the finished
  text would catch the lie only after the user had heard it. The model is handed back its own
  sentence and gets one more round, bounded by the tool-round budget so it cannot circle.
  Same guard covers claiming to remember on an empty memory.
- `1da098c0e` — "I cannot" is not offered as a way out. The first version of the correction
  said "call the tool or say you cannot", and a model just caught lying takes the second every
  time; a user told "I can't play your song" is barely better off. Now: call the tool, or hand
  the whole request to `app_ask_jester`. Inability only after something has failed.
- `6ef2bbaff` — a taught skill runs without consulting the model at all. "Play my favourite
  song" was failing at the last step for a reason unrelated to the skill: it existed, the
  address was in it, and the only thing in between was a small local model choosing to call
  `app_skill_do`. It did, most of the time. Matched by `findLocalSkill` against the trigger,
  the same function the tool uses.

**Unicode boundaries matter here.** `` is defined against ASCII, so `/şimdi/` matches
nothing at all, silently — in every locale this app speaks except English. The first detector
missed its own target sentence for exactly this reason; a test caught it.

## The standing goal

The user has asked for the app to keep going until it is genuinely a JARVIS-class assistant:
every request actually carried out rather than narrated, voice and typed chat at the same
capability, context-optimised and fast on 8 GB of VRAM, able to write decent code, fill PDF
forms, download and install applications, and to specialise as it is used. Claude Code's
range, on local models.

Done so far is the honesty floor — it no longer lies about what it did, and a taught skill
really runs. **Not started:** typed-chat parity (same tools, skills and memory as voice),
PDF form filling (see the correction below), downloading and installing applications, and
measured context/latency work. Measure before optimising: nobody has yet recorded turn counts
or prompt sizes against a small local model.

**Correction, and a warning about this document.** Two earlier versions of this handover said
`pdfjs-dist@5.5.207` was already installed, so PDF _reading_ would need no new dependency.
That is false. Checked on 8 August: neither `pdfjs-dist` nor `pdf-lib` appears in
`dependencies`, `devDependencies` or `node_modules`. **Both reading and writing need a
dependency that is not there.** The claim was inherited from a previous session and repeated
here without being verified — by me, in the rewrite that was supposed to make this document
trustworthy. Check what this file asserts about the tree before planning around it; the user
has authorised the PDF dependency, so adding one is the first step of that work rather than a
decision still outstanding.

---

## What is left

### The slow download, measured but not solved

**It is not our download loop, and that is now established rather than assumed.** Pulling the
first 25 MB of the published 2.3.4 asset on this machine: `curl` managed 9.7 MB/s, and the
app's own read/write loop — the exact loop from `attemptDownload`, run standalone against the
same bytes — managed **14.7 MB/s**, with no single read taking over 141 ms. The loop is faster
than curl. The obvious suspect is exonerated.

Also ruled out by reading: differential download is not involved (`differentialPackage: false`,
no `.blockmap` produced or uploaded, so electron-updater cannot be issuing ranged block
requests); no Electron command-line switch touches networking; the progress events are
throttled to 250 ms.

What is still open is which of two remaining candidates it is — GitHub asset throughput from
the affected region, or an event loop busy enough to starve the stream on a slower machine.
Both download paths now log throughput, host, and the count of reads that took over a second
on completion. **That stall counter is the thing that distinguishes them**: a slow read is the
network, a fast read followed by a slow write is this process. Wait for a real report with
numbers in it. **Do not "fix" this by guessing** — every plausible fix here is a change to
code that has been measured and found fast.

### Asked for, not started

- **PDF by voice** — summarise, translate, fill a form by asking for each value aloud.
  **Nothing is installed for this** — not `pdfjs-dist`, not `pdf-lib` (verified 8 August; two
  earlier handovers claimed otherwise). Reading and writing both need a dependency, and the
  user has authorised one, so adding it is step one rather than a decision to take.
- **Learning a skill by watching** — ask for an app it does not know, watch which one the user
  opens, remember it. The local-skills machinery from `612a5187b` is the half that exists, and
  `app_find_video` is the shape the other half should take.
- **The notch's fade level in settings.** The fade itself already works and is already 0.06;
  only the setting is missing. Genuinely small, and it has been on the list three sessions now.
- **A Turkish TTS voice with real prosody.** Measure before shipping: the bar is Pocket's
  0.43 s.

### Dropped by the user, with the reason

Interactive pop-ups and an app-owned media player. Worth keeping written down because it will
come up again: a controllable player (pause, seek, remaining time) and "play without stealing
focus" are both impossible with the default browser, since the app cannot see or drive another
browser's tabs. The only design that satisfies both is app-owned playback. The user chose the
default browser and dropped the pop-ups. Also deferred: the visual, Figma-like layout editor.

---

## Things that will waste your time if you do not know them

**Editing a builtin skill asset means rebuilding `foolcore`.** The catalogue in
`backend/core/crates/fool-app/assets/builtin-skills/auto-inject/fool-config/SKILL.md` is baked
into the binary. Editing it changes nothing until the binary is rebuilt and restaged, and it
fails silently — the agent simply does not know the key exists. `tests/unit/skills/foolConfigSkillKeys.test.ts`
catches an undocumented key, but nothing catches a documented one that never reached the
binary. Rebuild with a neutral `CARGO_HOME`:

```bash
CARGO_HOME=C:/cargo-clean node scripts/buildFoolcore.js
```

Anything else silently restores a `VCRUNTIME140` import — which breaks the backend on a Windows
without the VC++ redistributable, i.e. exactly a first-time user's machine — and bakes the
build machine's username into a public download. Verify, do not assume:

```bash
node -e "const s=require('fs').readFileSync('resources/bundled-foolcore/win32-x64/foolcore.exe').toString('latin1'); const u=process.env.USERNAME||process.env.USER||''; console.log(/VCRUNTIME140/i.test(s), u.length>0 && new RegExp(u,'i').test(s))"
```

Both must print `false`. Both did for the binary in this release.

**A new client preference must be added to `configKeys.ts`, not only to `storage.ts`.** The
skill catalogue test derives the app's real key set from `ConfigKeyMap` and
`ClientBusinessSettingMap`. A key added elsewhere and then documented reads as an invented key
and fails the test — which is the test working, but the message points at the document rather
than the registry.

**`bun run lint:fix` breaks `MotionBuilder.tsx`.** It rewrites a `readonly MotionMove[]` into a
`Set`, leaving the annotation wrong and the file failing `tsc`. It has done this twice. Run the
targeted formatter instead (`bunx oxfmt <paths>`), or check that file afterwards and revert it.

**The test suite reports a short count under load.** 4474, 4477, 4478, with
`Error: [vitest-pool]: Worker forks emitted error` and **no `FAIL` line** — it reads exactly
like tests silently vanishing. It is resource exhaustion from vitest's default parallelism. The
true figure is **4649 passed, 3 skipped, exit 0**, which `bunx vitest run --maxWorkers=2` gives
reliably. Four tests "failed" once inside `just push` while a 330 MB release asset was
uploading; the same command on a quiet machine passed. If a count ever does look wrong, settle
it with `bunx vitest list` against the working tree and against `HEAD`, then diff.

**Killing a build locks `out/win-unpacked`.** The next build does its full fifteen minutes and
then dies with `EPERM` at the very last step. Delete the directory first: the first `rm -rf`
says `Device or resource busy`, the second succeeds. No process shows up owning the handle, so
do not go looking for one.

**Do not wrap a build so its exit code is something else's.**
`bun run build-win:x64 > log 2>&1; echo "EXIT=$?"` reports the _echo's_ status; a background
task once said "exit code 0" while the log ended in `exited with code 1`. Redirect, read the
log, then look at the artifact on disk.
