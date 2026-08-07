# Handover — voice, layout and the release that has not gone out

Written 8 August 2026. Everything below is the state of `main` in `C:/Fool-AionUI` at commit `426c17c03`, version `2.3.3` in `package.json`, working tree clean.

**Read the two warnings at the bottom before building or publishing anything.**

---

## What is done, and where

Fifteen commits since `0bb1ce3f0`. Every one is on `main`, tested, and can be tried directly — nothing is on a worktree branch.

### The layout system, widened

`c8acc5552` — the editor could shape exactly one window, which made "customise the app" mean "customise the voice page". Four surfaces now (`voice`, `chat`, `hub`, `frame`), each with its own axes and its own built-in presets.

The load-bearing decision: a shape is published as **attributes on the document root** and answered in CSS, not by writing a second version of each page. Nobody was going to write a second Hub. See `common/config/surfaceShape.ts` and `renderer/styles/surface-shapes.css`; the Hub's own rules live in `FoolsHub.module.css` because its class names are hashed by CSS Modules and a global stylesheet cannot name them.

Also in there: a movement builder (`layout/MotionBuilder.tsx`) that compiles three dropdown choices into keyframes, so somebody who does not write CSS can add motion. Movements are stored on the preset and suppressed both by the app's own "still" setting and by the OS reduced-motion preference.

`0b5243b0c` — the app writes out its own specification (`common/config/layoutBrief.ts`) for pasting into whatever AI the user already talks to, and reads the answer back (`layoutImport.ts`). **The brief is generated from the same catalogues the editor draws and the sanitiser checks.** A hand-written one would describe the app as it was the day it was written and would silently start telling external models to produce presets this app rejects.

### JARVIS

`c8b9c15f5` — a second shipped workspace: four layouts, its own palette (`presets/jarvis.css`), its own persona instructions. It exists to be taken apart — wear it, like something, open the editor and find it already there.

Two things had to exist first: a workspace could not carry a palette, and exactly one workspace could ship. Both were fixed here.

It also fixed a real defect: applying a theme moved its stylesheet to the end of `<head>` and left the layout dials above it, so **choosing a palette straightened corners somebody had rounded**. `applyLayoutTokens` and `applyLayoutMotions` now re-append themselves.

### Voice

| Commit | What |
|---|---|
| `04e7d7176`, `2d0a4a98e` | A stalled turn no longer takes the conversation with it |
| `cbc0a122a` | A QR code a phone can actually reach |
| `ad12b3734` | A spoken setting change reaches the conversation it was said in; plus a second clock for a reply that streams and never speaks |
| `8a6dff569` | A rule the user sets is obeyed, and only kept when they say to remember it |
| `612a5187b` | Skills it can do itself, taught out loud |
| `32f764c39` | Those skills listed in Settings → Memory, where they can be withdrawn |
| `1d0c8a27e` | The talk key opens a conversation instead of a dictation turn |
| `03a551166` | Hand it a file by dropping one on the window |
| `426c17c03` | Updates install silently and the app comes back up |

Three of these are worth understanding rather than just knowing about:

**The freeze was not what it looked like.** A 45-second watchdog existed, but it asked whether the *connection* was alive, not whether the *reply* was going anywhere. Local models write their deliberation into `reasoning_content`, which is deliberately never read aloud — every one of those frames reset the watchdog. A model that deliberated forever wedged the conversation with no ceiling and nothing on screen. `SILENT_REPLY_MS` is a second clock, armed once per turn and cleared by the first visible character. It is deliberately *not* reset by traffic; resetting it would make it the same watchdog again.

**Memory was not being obeyed because of position.** The language setting is written into the prompt as "answer only in Turkish, every reply, every time". A rule the user set arrived earlier in the text and simply lost. Rules now come last, under their own heading, stated as overriding everything above. Session rules (not written down) and remembered rules are presented identically — the difference is how long they live, not how firmly they are said.

**Local skills are the most dangerous record in the app.** Written by a model, out of a conversation that may have included a web page, and they end in something being opened. `common/voice/localSkills.ts` is closed by construction rather than repaired on read: `http(s)` only, absolute paths only, refused outright if a path could carry an argument, chain a command, redirect or expand a variable. Every other sanitiser in this codebase falls back to a default because the cost of being wrong is a window drawn the wrong shape. Here the cost is running something, so there is no default worth having. Sixteen tests pin the refusals.

---

## What is not done

### Asked for and not started

- **PDF by voice** — summarise, translate, and fill a form by asking for each value in conversation. `pdfjs-dist@5.5.207` is already installed, so reading needs no new dependency. **Writing a filled form does** — `pdf-lib` or similar — and adding a dependency is a decision for the user, not something to slip in.
- **Changelog pop-up after an update.** The silent install landed without it, so updates are currently quiet in both senses: they install without a window *and* without telling anyone what changed. This is half a feature and should be finished before the next release goes out.
- **JARVIS, cinematic.** The user asked for the Hub's JARVIS preset to feel like it came out of the film — heavily animated, Figma-like — as the last thing before release. The palette and the four layouts are in place; the cinematic pass is not.

### Asked for earlier, still open

- Voice conversation history: it resets to zero every launch, and there is no conversations panel, no saved transcript, no resuming a past one.
- Learning a skill by watching: ask for an app it does not know, watch which one the user opens, remember it.
- The notch's fade level, adjustable in settings. **The fade itself already works** and is already 0.06 — only the setting is missing.
- A Turkish TTS voice that reads with real prosody. Measure before shipping: the bar is Pocket's 0.43 s.

### Dropped by the user

Interactive pop-ups and an app-owned media player. Worth recording *why*, because it will come up again: a controllable player (pause, seek, remaining time) and "play without stealing focus" are both impossible with the default browser — the app cannot see or drive another browser's tabs. The only design that satisfies them is app-owned playback. The user chose the default browser and dropped the pop-ups instead.

Also deferred by the user: the visual, Figma-like layout editor.

---

## Two warnings

### 1. `foolcore` must be rebuilt before the next installer

`backend/core/crates/fool-app/assets/builtin-skills/auto-inject/fool-config/SKILL.md` gained a row documenting `voice.localSkills`. **That file is baked into the `foolcore` binary.** Editing the asset changes nothing until the binary is rebuilt and restaged, and it fails silently — the agent simply will not know the key exists.

Rebuild through the project's script with a neutral `CARGO_HOME`. The staged binary otherwise drifts: it silently regains a `VCRUNTIME140` import and the build machine's username.

### 2. The release has not been published, and the reasons are not all mine

`2.3.3` was built and verified on disk earlier in the session (`out/TheFool-2.3.3-win-x64.exe`, 330,014,392 bytes, `latest.yml` matching). **That artifact predates the seven voice and update commits above** — it is not what should go out.

Before publishing anything:

- Rebuild `foolcore` (see above), then the installer with `bun run build-win:x64`. Not `build:win` — that script does not exist, and the failure looks like success because the compound command's last step succeeds. **Check the `.exe` timestamp and size on disk; never trust the exit code.**
- The installer is **unsigned**. electron-builder prints "signing with signtool" and then prints `NOT signed (NotSigned)` at the end. SmartScreen will warn on any machine that has not seen the build.
- Auto-update needs a **published, non-draft** release with `latest.yml` uploaded. A public repo alone is not enough.

I did not publish. The list the user asked to be finished is not finished, and a release is outward-facing and hard to take back.

---

## Running the test suite

`bun run test` on this machine intermittently reports a **short** count — 4474, 4477, 4478 — with `Error: [vitest-pool]: Worker forks emitted error` and **no `FAIL` line**. It reads exactly like tests silently vanishing.

It is resource exhaustion from vitest's default parallelism, not a regression. The true figure is **4502 passed, 3 skipped, exit 0**, which `bunx vitest run --maxWorkers=2` produces reliably. (`--poolOptions.*` is not a valid flag on this vitest and errors with `Unknown option`.)

If the count ever does look wrong, the way to settle it is `bunx vitest list` against the working tree and against `HEAD`, then diff. That proves whether a test exists, independently of whether a worker survived long enough to run it.

---

## Where to pick up

1. Rebuild `foolcore`, since the asset edit is already committed and inert until you do.
2. Finish the changelog pop-up — the silent install is half a feature without it.
3. The cinematic JARVIS pass.
4. Decide on `pdf-lib`, then PDF.
5. Rebuild, verify the artifact on disk, publish.
