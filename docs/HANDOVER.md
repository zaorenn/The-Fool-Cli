# Handover — 2.3.4 is out, and four fixes sit on top of it

Written 8 August 2026. `main` in `C:/Fool-AionUI` at `3fbb50034`, version `2.3.4`, tree clean,
pushed at `3fbb50034`; four further commits have landed since and are **not yet in a release** — see "After 2.3.4" below. **[v2.3.4](https://github.com/zaorenn/The-Fool-Cli/releases/tag/v2.3.4) is published,
non-draft, with both assets uploaded** — the first release since 2.2.55, and it carries the
whole 2.3.x line with it.

The two warnings that opened the previous version of this document are both resolved. What
replaces them is at the bottom, and it is shorter.

---

## The release, and how it was checked

Nothing here was taken on trust from an exit code, because on this project an exit code has
lied twice.

| Checked                      | Result                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| Installer on disk            | `out/TheFool-2.3.4-win-x64.exe`, 330,033,719 bytes, built 01:20                                    |
| `latest.yml` vs the file     | version, path and SHA-512 match the bytes on disk exactly                                          |
| The feed the updater fetches | `releases/latest/download/latest.yml` → **HTTP 200**, correct hash                                 |
| The installer download       | **HTTP 200**, resolving to `release-assets.githubusercontent.com`, which is on the app's allowlist |
| Release state                | `draft=false  prerelease=false`, both assets `uploaded`                                            |
| Test suite                   | **4530 passed, 3 skipped, exit 0** — twice, once directly and once inside `just push`              |

The installer is still **unsigned**. electron-builder prints `signing with signtool.exe` for
every executable it touches and then prints `NOT signed (NotSigned)` at the end; the second
line is the true one. SmartScreen will warn on any machine that has not seen this build. The
release notes say so.

## What shipped in 2.3.4

Seven voice commits from the previous session that had never been in a release, plus four
written this one.

### The changelog pop-up — `f902a7fca`, `78b2a4a64`, `3fbb50034`

The silent install landed last session without it, which made updates quiet in both senses.
This is the other half: on the first launch after the version moves, that release's own
entries, once.

Three decisions worth keeping:

**It reads the changelog shipped inside the app, not GitHub.** `CHANGELOG.md` is an
`extraResource` now and lands in `resources/` beside `LICENSE`. The machine that just came
back up from a silent install may not be online, and a window that says what changed is worth
much less if it only appears sometimes.

**Dismissal is what records the version, not display.** A window closed by a crash shows the
same notes again rather than losing them.

**It had to be taught to fire on its own release.** Nothing has ever recorded a version, so
every existing installation looked exactly like a fresh one — a feature whose whole job is to
say what changed would have shipped mute on the one update that introduced it. The signal for
"this installation has run before" is the saved window bounds. It is _not_
`system.firstRunGreeted`, which is only ever written with `configService.setLocal` — an
in-memory cache write that never reaches disk, so it reads `undefined` on every launch
including the ten-thousandth. That was caught by reading `setLocal`, not by testing.

### JARVIS, switched on — `8cf295133`, `fba0a6af5`

The palette drew a projected display; this makes it a running one. Boot sweep on arrival, the
grid drifting one tile every forty seconds, a refresh band every nine, the accent breathing at
its supply, a point of light running the underside of the title bar, and the Hub as a bay with
the worn workspace armed at its leading edge.

**The load-bearing discovery, and the reason there is a whole extra stylesheet:** a theme
preset's CSS is run through `processCustomCss`, which appends `!important` to every
declaration. That does two things, both silent:

1. `@keyframes` written in a preset are **dead** — an important declaration inside a keyframe
   is ignored, so the block ends up empty.
2. A resting value in the preset **kills an animation declared anywhere else**, because
   important author declarations sit above animations in the cascade.

So the motion lives in `renderer/styles/jarvis-cinema.css`, scoped by a new `data-theme-id`
attribute that `applyTheme` sets from `theme.id`, and the palette had to be stripped of every
property that file animates — including through shorthands, since `background` pins
`background-position` as surely as naming it. Written the obvious way, the button would never
have breathed, the light would never have run and the edge would never have charged, and all
three would have looked perfectly correct in the source.
`tests/unit/renderer/jarvisCinema.test.ts` holds both halves of that line.

Everything ambient is `transform` and `opacity`, nothing sits above text at an opacity you
could read through, and both stops are wired: `prefers-reduced-motion` and the frame's own
movement dial, where `calm` keeps the arrival and drops every loop.

### Already written, now actually released

`ad12b3734` a spoken setting change reaching the conversation it was said in, plus the second
clock for a reply that streams and never speaks · `8a6dff569` a rule the user sets being
obeyed, and only kept when they say so · `612a5187b` skills it can do itself, taught out loud ·
`32f764c39` those skills listed in Settings → Memory where they can be withdrawn ·
`1d0c8a27e` the talk key opening a conversation rather than a dictation turn · `03a551166`
handing it a file by dropping one on the window · `426c17c03` silent install.

---

## What is left

### Asked for, not started

- **PDF by voice** — summarise, translate, fill a form by asking for each value aloud.
  `pdfjs-dist@5.5.207` is already installed so reading needs nothing new. **Writing a filled
  form does** — `pdf-lib` or similar — and adding a dependency is the user's call.
- **Voice conversation history.** It still resets to zero every launch: no conversations
  panel, no saved transcript, no resuming a past one. This is the largest thing outstanding.
- **Learning a skill by watching** — ask for an app it does not know, watch which one the user
  opens, remember it. The local-skills machinery from `612a5187b` is the half that exists.
- **The notch's fade level in settings.** The fade itself already works and is already 0.06;
  only the setting is missing. Genuinely small, and it has been on the list two sessions now.
- **A Turkish TTS voice with real prosody.** Measure before shipping: the bar is Pocket's
  0.43 s.
- **Some users download the installer at about 50 kbps on a fast connection.** Not diagnosed.
  What has been ruled out, so it is not re-checked: differential download is not involved
  (`differentialPackage: false`, no `.blockmap` is produced or uploaded, so electron-updater
  cannot be doing ranged block requests); no Electron command-line switch touches networking;
  the manual download loop in `updateBridge.ts` handles backpressure correctly and throttles
  its progress events to 250 ms. The remaining suspects are the ones that need a real
  measurement rather than a reading: GitHub asset throughput from the affected region, and
  electron-updater 6.6.2's own HTTP client on the auto path. **Do not guess at a fix** — add
  throughput and resolved-host logging to both download paths first, so the next report
  arrives with evidence. A CDN in front of our own releases is the likely remedy if the
  answer turns out to be regional; the code comment in `updateBridge.ts` explains why
  upstream's CDN was removed and cannot simply be re-enabled.

### Dropped by the user, with the reason

Interactive pop-ups and an app-owned media player. Worth keeping written down because it will
come up again: a controllable player (pause, seek, remaining time) and "play without stealing
focus" are both impossible with the default browser, since the app cannot see or drive another
browser's tabs. The only design that satisfies both is app-owned playback. The user chose the
default browser and dropped the pop-ups.

Also deferred: the visual, Figma-like layout editor.

---

## Things that will waste your time if you do not know them

**The test suite reports a short count under load.** 4474, 4477, 4478, with
`Error: [vitest-pool]: Worker forks emitted error` and **no `FAIL` line** — it reads exactly
like tests silently vanishing. It is resource exhaustion from vitest's default parallelism.
The true figure is **4530 passed, 3 skipped, exit 0**, which `bunx vitest run --maxWorkers=2`
gives reliably. (`--poolOptions.*` is not a valid flag on this vitest.) If a count ever does
look wrong, settle it with `bunx vitest list` against the working tree and against `HEAD`,
then diff — that proves whether a test exists independently of whether a worker survived.

**Killing a build locks `out/win-unpacked`.** The next build does its full fifteen minutes and
then dies with `EPERM` at the very last step. Delete the directory first: the first `rm -rf`
says `Device or resource busy`, the second succeeds. No process shows up owning the handle, so
do not go looking for one.

**Do not wrap a build so its exit code is something else's.**
`bun run build-win:x64 > log 2>&1; echo "EXIT=$?"` reports the _echo's_ status; a background
task said "exit code 0" while the log ended in `exited with code 1`. Redirect, read the log,
then look at the artifact on disk.

**`foolcore` must be rebuilt through the script, with a neutral `CARGO_HOME`.**

```bash
CARGO_HOME=C:/cargo-clean node scripts/buildFoolcore.js
```

Anything else silently restores a `VCRUNTIME140` import — which breaks the backend on a
Windows without the VC++ redistributable, i.e. exactly a first-time user's machine — and bakes
the build machine's username into a public download. Verify, do not assume:

```bash
node -e "const s=require('fs').readFileSync('resources/bundled-foolcore/win32-x64/foolcore.exe').toString('latin1'); console.log(/VCRUNTIME140/i.test(s), /sarhen/i.test(s))"
```

Both must print `false`. Both did for the binary in this release, and it carries the
`voice.localSkills` documentation that was inert in the previous one.

---

## After 2.3.4, unreleased

Four commits on `main` that no installer carries yet. A release needs a version bump, a
`CHANGELOG.md` entry, a rebuilt installer verified on disk, and a published tag.

| Commit                    | What                                               |
| ------------------------- | -------------------------------------------------- |
| `adb7e804f`               | Teaching a skill it can see but has no address for |
| `90b97bb67`               | A TTS model released when you switch away from it  |
| `6962d09bb`, `f902a7fca`… | (handover and the 2.3.4 work itself)               |

**`adb7e804f` — why "play my favourite song" could not be taught.** The tool schema does not
require an address, because the name and the trigger arrive a turn before one does. The
handler answered that case with the generic "not something the voice can do", so the model
read it as the tool being broken and fell back to asking the user to describe the steps by
hand. Underneath was a real gap: looking at the screen gives a title, never an address — the
browser sits behind our own window and its address bar is not in the picture. `app_find_video`
resolves a title to a real watch address without opening anything, and the model is told to
offer what it found and wait for a yes before saving, because this is a guess from a title.

**`90b97bb67` — why a graphics card filled up.** The audio.cpp server was handed _every_
installed model, and it loads every entry it is given and holds those weights for the life of
the process. Four downloaded voices meant four resident at once, and choosing a different one
released nothing, because the config had not changed and so the child was never replaced. The
config carries one model now, which puts it in the runtime signature and makes a voice change
a teardown. Switching to a different engine shuts it down entirely.
