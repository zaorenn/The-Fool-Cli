# Handover — 2.3.5 is out

Written 8 August 2026. `main` in `C:/Fool-AionUI` at `7cc4b564f`, version `2.3.5`, tree clean,
pushed. **[v2.3.5](https://github.com/zaorenn/The-Fool-Cli/releases/tag/v2.3.5) is published**,
non-draft, both assets uploaded, and the live feed answers with it. Nothing is sitting
unreleased.

---

## The release, and how it was checked

Nothing here was taken on trust from an exit code, because on this project an exit code has
lied twice.

| Checked                      | Result                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Installer on disk            | `out/TheFool-2.3.5-win-x64.exe`, 330,035,052 bytes, built 04:25                                                     |
| `latest.yml` vs the file     | SHA-512 recomputed from the bytes on disk; identical                                                                |
| The feed the updater fetches | `releases/latest/download/latest.yml` → **HTTP 200**, version 2.3.5, matching hash                                  |
| Release state                | `draft=false  prerelease=false`, both assets `uploaded`                                                             |
| Staged `foolcore`            | rebuilt; no `VCRUNTIME140` import, no build-machine username, and the new catalogue row genuinely inside the binary |
| Packaged `CHANGELOG.md`      | present in `resources/`, opening on the 2.3.5 section                                                               |
| Test suite                   | **4565 passed, 3 skipped, exit 0** — twice, once directly and once inside `just push`                               |

The installer is **unsigned**. electron-builder prints `signing with signtool.exe` for every
executable it touches and then prints `NOT signed (NotSigned)` at the end; the second line is
the true one. SmartScreen warns on any machine that has not seen the build, and the release
notes say so.

## What shipped in 2.3.5

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
  `pdfjs-dist@5.5.207` is already installed so reading needs nothing new. **Writing a filled
  form does** — `pdf-lib` or similar — and adding a dependency is the user's call.
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
node -e "const s=require('fs').readFileSync('resources/bundled-foolcore/win32-x64/foolcore.exe').toString('latin1'); console.log(/VCRUNTIME140/i.test(s), /sarhen/i.test(s))"
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
true figure is **4565 passed, 3 skipped, exit 0**, which `bunx vitest run --maxWorkers=2` gives
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
