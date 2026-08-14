# Changelog

The Fool is a fork of [AionUi](https://github.com/iOfficeAI/AionUi) (Apache-2.0). Release history from before the fork lives in that project; this file records what has changed here.

## 2.5.5

The first release since the packaging work in 2.5.4, and the one that carries
everything that had been sitting on a branch: a theme system, a route to a
phone that needs no cable, a PDF engine that can write on documents with no
form fields, and the removal of two things that were only ever half here.

### A palette you cannot pick your way out of

A colour wheel lets anybody land on a point that derives an unreadable
interface, and a model asked to pick a colour will do exactly that. The picker
is gone. In its place is a closed list of nine accents that already carried the
promise of deriving a readable palette in all seven materials — they now have
names, keywords and ids, so they can be the choice rather than a hint beside a
wheel. Asking for the theme in shades of green resolves to a palette; a hex
written into the sentence resolves to nothing at all.

Underneath it, three faults that had made the theme partly decorative:

- **Twenty-four colour variables were read by the app and written by nothing.**
  They had no value from the theme at all.
- **The material was outranked by four colours that ignored the light.** A
  material that names a colour now cannot override the light it is rendered in;
  three of them had named white.
- **Eighty-six files were never painted.** The palette now reaches them, and a
  test asserts all 126 palette, material and appearance combinations are
  readable rather than trusting that they are.

The window also stops opening in the palette this project was forked from.
`default-color-scheme.css` paints on the first frame while the active theme is
still being read from storage, so the shell opened purple and changed a moment
later — most visibly at the top-left corner where the sidebar meets the chrome.
The four tokens painted before hydration now hold this project's values. It is
a prepaint, not a second theme.

### The phone, without a cable

Installing on a phone meant USB and developer mode, or `eas build --local`,
which still wants an Expo login and reads iOS passwords from the macOS keychain.
Neither is a route from a Windows machine to a phone across the room.

`npm run apk` runs `expo prebuild` and drives Gradle directly; `npm run apk:serve`
puts the result on the local network so the phone installs it from its browser.
The served addresses put private LAN ranges first and exclude link-local,
because an adapter that never got a lease still advertises a 169.254 address
that nothing can reach. Release builds are signed with a keystore created once
under `~/.fool/android` rather than the shared debug key that `expo prebuild`
rewrites from template on every run — measured across builds 17 and 18, same
certificate digest, ascending version codes, which is what Android requires to
accept an install as an update.

Getting from built to actually connected took four more fixes, each independent
of the others: the app died on its first launch; the QR code served the app
instead of the login page; the address inside it was one nothing on the network
could reach; and the phone then failed to connect for two further unrelated
reasons. The remaining dead channels — conversations, the file tree, image
previews — now go over REST like everything else.

Two authentication faults went with them. CSRF was refusing the launcher's own
privileged calls, and remote access was handing a signed-in session to the whole
subnet.

### A PDF that has no form to fill

The fill path that shipped only works on documents carrying an AcroForm, and
none of the three this was tested against has a single form field. `pdf-lib` can
draw on a page but cannot read one, so filling a flat document means finding the
anchor visually — the label to write beside, the question to write under.

`pdfLayout` wraps pdfjs-dist to return every text run's box in PDF user space,
the same space `drawText` uses, so an anchor can be handed straight to a draw
call. Two queries sit on it: `freeSpaceRightOf` stops at whatever shares the
baseline, because a value written past a second label on the same line lands on
top of it, and `freeBandBelow` is floored only by things that actually overlap
horizontally — a run in another column shares the vertical range without being
in the way, and treating it as a floor reports no room where there is plenty.

The measurement that shapes the rest is a test rather than a claim: the gap
under each exam question is under 60 points, about three lines at 12pt, so a
worked solution does not fit beneath its question.

### The screen-driving sidecar is gone, including from machines that had it

`uacc-computer-control` was a builtin MCP server pointing at an absolute path on
one developer's machine, shipped enabled to every installation. Deleting the
entry would not have removed it: bootstrap only ever imports the defaults not
yet in the database and nothing walks the other way, so a builtin removed from
the source stays registered forever on every machine that already received it.
That is the shape of "removed" a user reports as "it is still there".

There is a retirement list now, consulted on every launch, with each deletion's
failure kept local so a builtin that will not delete is not a reason to stop the
app starting. Verified in the running app: six registered servers before, five
after, and no uacc among them.

### Voice

A turn can stop and ask for what it was not told, then carry on. A look says
which window it got and admits when it got the desktop instead. Asking for a
song plays one in the background rather than driving the screen to do it.

Four faults behind them: the context budget was assumed rather than asked of the
local server; a local model was re-summarising its whole conversation on every
turn; each tool's behaviour was being stated twice, in two voices; and a
substring was deciding what to do, in two separate places. The notch was
reporting what had happened rather than what was happening, and a single
ellipsis could make the assistant say nothing at all.

### What was taken out rather than finished

The in-app browser tabs were carried across in the port and never wired to
anything. Measured before removing: `openBrowserTab` had no production callers,
`PreviewContext` never declared it, and `BrowserTabLayer` was imported into
`PreviewPanel.tsx` on the import line and rendered nowhere. The only route to
any of it was an Explorer menu item opening a content type the preview panel has
no viewer for. It is gone, and the Explorer's add-folder control is a button
again rather than a dropdown built to house the browser entry beside it.

The team board view is likewise withheld until the backend it calls exists.

The suite is 593 files and 6010 tests with no failures. Four of those test files
had been testing the removed browser code — one against a module that does not
exist in this tree — and a fifth was a scratch probe that asserted nothing and
wrote a JSON dump to a hardcoded path on a single machine, so it would have
failed anywhere else, CI included.

---

## 2.5.4

### A file name that two files spelled differently

2.5.3 was the first run in which every platform built. All six desktop jobs were
green, all five web-cli jobs were green, and the release still could not have
been cut — because of a space.

`artifactName` in `electron-builder.yml` is `TheFool-${version}-${os}-${arch}`,
deliberately without a space: electron-builder writes the name into `latest.yml`
with spaces turned into hyphens, GitHub hosts the upload with spaces turned into
dots, and every installed copy then asks for a URL the release does not have.
Three other files never got the message.

- **The macOS zips were built and then dropped.** The upload step globbed
  `out/The Fool-*-mac-*.zip`, which matches nothing a real build produces. In
  2.5.3 macOS x64 wrote a 477 MB zip next to its 472 MB DMG and uploaded an
  artifact of 493 MB — the DMG alone. `prepare-release-assets.sh` would then
  have failed the release looking for the zip that had just been thrown away.
- **The asset validation was checking for files no build has ever made.** It
  required `The Fool-${VERSION}-mac-${arch}.dmg`, so it would have called a
  complete six-platform build incomplete.
- **`verify-release-assets.sh` was checking nothing at all.** Its list of
  distributables was unquoted, so the shell split on the space and it looked for
  a file called `The`.

None of this had ever been caught because the mock artifacts the PR check runs
against carried the old spaced names too — the check validated a fiction. The
mock now writes the names a real build writes, and a test asserts that the
upload glob matches what `artifactName` expands to, rather than asserting the
two strings separately and never comparing them.

Underneath that, the tolerance added in 2.5.3 was sitting behind a stricter
check and could never fire: `prepare-release-assets.sh` still exited on the
first missing platform, before the step that warns and continues was reached.
Validation is consistency rather than completeness now — a platform that did not
build is named in a warning, while a platform that _did_ build and is missing
the metadata the updater needs still fails the job. The web-cli packing was
likewise still required outright, and could withhold a desktop release on its
own.

## 2.5.3

### The release that was being withheld by the platform it was not for

The release job required **every** entry in a six-platform matrix. One platform
failing for a reason of its own therefore threw away the artifacts of the five
that had built — and in 2.5.1 the Windows installers were finished, correct, and
discarded. Nothing has been published since 2.3.10 on 8 August for that reason.
The gate is the artifacts now, not the jobs: a Windows installer is required
because that is what the updater feed serves, and anything else missing is named
in a warning and shipped without. A user on a platform that failed to build is
no worse off than a user of a release that was never cut.

Underneath it, two more single-platform failures, each of which had been enough
on its own:

- **An absent Sentry token stopped the build.** A step declared three secrets
  "required for desktop source map uploads" and exited 1 without them. Source
  maps are how a crash report names a line rather than a minified column; that
  is worth having and it is not worth the release. Missing secrets switch the
  upload off and leave a warning. (The same step could not see the secrets even
  when they existed — a step's environment does not contain a repository secret
  unless the step asks for it, which is a failure that looks exactly like
  success.)
- **The rebuild tool failed before it rebuilt anything.** `bunx electron-rebuild`
  resolves the deprecated package name, which still depends on `lzma-native`,
  which has no prebuilt binary for arm64 Linux. So installing the _tool_
  compiled that dependency, and the step's Electron headers URL was handed
  Node's own version — a 404 on `v22.23.1/node-v22.23.1-headers.tar.gz`, before
  a line of this project's code was built. `@electron/rebuild` carries no such
  dependency.

### It stops talking when you start typing

The silence contract has had a "the user is typing" rule since it was written,
and every caller answered it with `false`, on the grounds that nothing in a
spoken conversation can watch a keyboard in another window. Something can: the
hold-to-talk hook already reads every keystroke on the machine for the
combination rule. It now asks one more question of a key that is not the talk
key — whether one arrived, never which — and repeats the answer while typing
continues, so a long message is not read as having ended after its first
character.

Wiring it turned up the larger fault. **A finished background task was being
announced out loud to somebody who had said "be quiet"**, or who had switched
unprompted speech off entirely. The conversation was supplying the hush, the off
switch and the talk key; the type in between named three fields and dropped the
other three on the floor.

### It tells you which model your computer can run

"It is running, but no model is loaded yet" was the whole instruction the setup
panel gave, in front of a catalogue of thousands of files named like
`Qwen3-14B-Q4_K_M.gguf`. This is where local-first quietly fails: the only way
to learn that the 14B does not fit in 8 GB is to download twelve gigabytes and
watch it not fit.

The panel now names one size, says what it is realistically good for, gives a
search term you can copy, and lists the alternatives in a line. It also says
which measurement it is standing on, because a figure read from the card and a
share of system memory are different claims — `Win32_VideoController.AdapterRAM`
is a 32-bit field, so every card above 4 GB reports exactly 4 GB, which is worse
than no answer at all.

## 2.5.2

The last two things standing between this line and a published release, both
found by the 2.5.1 run getting further than any run before it.

- **`electron-rebuild -w` does not narrow anything.** `--which-module` adds a
  module to the set rather than restricting it, so the 2.5.1 fix looked right
  and changed nothing — Linux and macOS walked into `uiohook-napi` exactly as
  before. `--only` is the flag that means only.
- **The Linux binary was built against a glibc most machines do not have.**
  Compiled on the newest runner, `foolcore` linked `GLIBC_2.38` and `2.39`; the
  smoke test runs in `debian:bookworm-slim`, which has 2.36, and said so. glibc
  is forward compatible and not backward, so the Linux jobs build on 22.04 now.
  The smoke test was right and had simply never been reached before.

## 2.5.1

The build that 2.5.0 could not finish. Its quality gate passed — the one that had
stopped every release since 2.3.4 — and then every macOS and Linux job failed on
two things that had never been reached before, because no run had ever got that
far.

- **`backend/core/Cargo.lock` was not committed.** The workspace inherited a
  library `.gitignore` from the project it was forked from, whose own comment
  says to remove the line when the crate builds an executable. Nobody had.
  `buildFoolcore.js` compiles with `--locked`, which cannot create a lockfile it
  does not find, so CI could never build the backend from source — and the
  dependency set was resolved fresh on every machine that ever built it.
- **`uiohook-napi` was being rebuilt on Linux and macOS.** It ships a prebuilt
  N-API binary precisely so it does not have to be; N-API is ABI-stable across
  Node and Electron versions, so the rebuild bought nothing and needed X11
  development headers the runner does not have. The Windows path already
  rebuilt only `better-sqlite3`; the other platforms do the same now.

## 2.5.0

Carries everything 2.4.0 was going to. That version was tagged on 9 August and never built — the tag still points at the commit that bumped it, with none of the work below in it — so the number moves on rather than being quietly redefined.

### It opens, and the window is not blank

- **The packaged build emitted circular vendor chunks.** React, Arco, the markdown stack and the editors were split into separate chunks that imported each other in a ring, and with a ring the evaluation order can reach `React.createContext` before React's own exports exist — an empty window, in a build whose exit code was 0. They share one chunk now, and the build is checked for the warning rather than for its status.

### Themes that actually apply

- **A theme's stylesheet is read rather than pattern-matched.** Every declaration is marked `!important` on the way in so a theme can outrank the app, and the thing doing the marking was a regular expression that could not tell a declaration from the colon in a selector. `.btn:hover` became `.btn: hover`, and the browser dropped the rule with it — 41 rules in Retro Windows, 39 in Misaka Mikoto, 25 in Hello Kitty. It also cut `url(data:image/png;base64,…)` in half, which is what the theme editor writes when you give a theme a background. All of it applies now, including the animations, which were being voided by the same pass.
- **The words on a button can be read.** The label on an accent-coloured surface was chosen by a luminance threshold, and on a mid-toned accent neither black nor white clears the bar — the gold this app ships with measured 2.41:1 against a floor of 4.5. It is measured now, across every material and both appearances, and the worst pairing is 4.51:1.
- **Five settings stopped fighting over the same colours.** A palette, a material, the layout dials, the motions and the colours you pick by hand all write the same variables, all marked important, and each one re-appended itself last on every change — so the winner was whichever setting you touched most recently, and on a cold start the material always won. A colour you chose no longer disappears when you restart.
- **The theme gallery shows what clicking will do**: each card drawn in that theme's own appearance rather than the app's current one, and the two flagship palettes no longer fall back to a preview belonging to no theme at all.
- **Backslashes are backslashes** in the Y2K skin, which was leading with a font that draws them as yen signs.

### The voice, and the silence in front of it

- **The wait before the first word fell from 2.9 seconds to under one.** Sending no deliberation setting does not mean "think a normal amount", it means "think as much as you like": asked where a folder was that had been named one line earlier, the model produced 20,905 characters of reasoning and took 68 seconds to speak. Thinking is bounded now, and it cost nothing measurable — the same 17 of 17 eval tasks pass, three runs each.
- **It cannot describe a screen it has not looked at.** The gate that catches "I did that" now catches "the screen says" too, and the evidence is a capture that succeeded rather than one that was attempted.
- **It asks you one thing, and never the same thing twice.** A question after a pause, at most one a conversation, never during a task — and a subject is written down when it is asked rather than when it is answered, because a question ignored once was an answer.
- **What it learned about you can be taken back.** Every write keeps the version before it, and one button in Settings → Memory puts it back.
- **Anything it says unasked has a switch**, and saying "be quiet" hushes it for the session.
- **It knows what you were doing yesterday**, assembled from the stored line word for word rather than asked for — a model asked to recall the last conversation will recall one whether or not there was one.
- **A finished piece of work is worth a word**, and the filler said while it thinks no longer arrives as the answer.

### Everywhere else

- **Copying an answer copies the answer.** A reply interrupted by a tool call is several messages, and the copy button took the last one — handing back a fragment that reads like the whole thing.
- **The first screen offers every agent it found**, not two named in a constant. The backend already resolves around thirty on `$PATH`.
- **Right-click in the file tree**: reveal in folder, copy path, copy relative path.
- **A shortcut answers to this platform's modifier**, rather than to either.
- **The image tool cannot read outside the workspace.** Paths arrived in a tool call the model wrote and were resolved with no boundary, so `../../../` was read and handed back.
- **The backend has a version you can name.** CI claimed one was pinned in `package.json`; the key did not exist, so every binary this repository has produced reported the same string. It is declared and asserted now, the bundle records the commit, and both workflows cache the Rust build they had been doing from scratch every time.

### Earlier in this line

The first release this project's own CI has built. Every `Build and Release` run since 2.3.4 stopped before it started — five lint errors in the quality gate, so the build pipeline was skipped every time and the installers on those releases were made by hand. That is fixed, which is why this entry exists at all.

The first release this project's own CI has built. Every `Build and Release` run since 2.3.4 stopped before it started — five lint errors in the quality gate, so the build pipeline was skipped every time and the installers on those releases were made by hand. That is fixed, which is why this entry exists at all.

### One harness behind every conversation

- **The spoken assistant thinks on the same runtime typed chat does.** It had its own small loop with a handful of app tools; talking to it and typing to it were two different assistants with two different memories and two different sets of abilities. Now a spoken conversation opens a real session — same context handling, same tools, same skills — and this app keeps what it was always good at, which is sound. The old loop is still there, silently, for a machine that cannot open a session.
- **An agent can ask the application to do something.** Looking at the screen, opening a page, changing the colours, remembering a fact: these were the voice's private tools. They are now offered to every agent that runs here, over a channel that waits for a real answer and fails rather than hanging when none comes. A tool an agent cannot honestly carry out is withheld instead of advertised.
- **A skill you taught out loud is known to every agent.** Teaching one meant teaching the voice, and only the voice.

### Nothing it says about its work is unbacked

- **No sentence reaches the speaker without evidence behind it.** "It's playing now", said with nothing running, is the most damaging thing this assistant can do, and a rule in the prompt does not stop it — a model that has decided it finished will say so in whatever words the prompt did not forbid. The check now sits in front of the speaker rather than after the reply, so a false claim is caught before it is heard, and it covers every way of talking to the app rather than one of them.
- **A claim is caught by its grammar rather than by a word list**, in each of the thirteen languages.
- **What counts as evidence is a tool that finished, not a tool that started.** A task handed to the agent comes back the moment it is accepted; counting that would let "I've booked your flight" through with the booking still running.

### A delegated task no longer stops the conversation

- **Ask for something real and keep talking.** Handing a job to the agent used to hold the spoken turn open for as long as the job ran — minutes, on a real desktop — so the conversation could not go anywhere else and a second request had to queue behind the first. The task is accepted, the conversation carries on, and the finish arrives later as something the assistant volunteers.
- **It waits for a gap.** Never over an answer, never over you, and never on top of the previous one. Two jobs finishing while a third is being discussed is the normal case once delegating is cheap.
- **"What did it say?" has an answer.** The spoken line is short on purpose; the result goes into the conversation at the same moment, so you can ask.

### The voice, in the places it was thin

- **It says something into a silence instead of leaving you there.** Twenty seconds of nothing from something that was talking a moment ago reads as a crash, so people ask again and the same job runs twice. It fills the gap the way a person does, less often the longer it goes, and never over real speech.
- **A turn that did work says what it did, not what it wrote.**
- **The model that answers can be changed mid-conversation.** It was resolved once, when the conversation opened, so "switch to the bigger model" was agreed to out loud and then ignored for the rest of the session. Asking for a model that is not loaded is now refused by name rather than confirmed.
- **An assistant you write, kept under a name you chose.** The four presets are the four things this was built for; anything else went into one box and lasted until you wanted the other one back. Keep as many as you like, put one back on with a click or by saying its name.
- **A rule set out loud binds the next turn** rather than the next conversation.
- **One memory, read by every conversation** — and one that can be argued with and taken back.

### What the app is made of, chosen in about ten clicks

- **Seven materials, and the whole interface is made of the one you pick.** Not a colour scheme: the thickness of a surface, how light falls on it, how hard an edge is. A colour picker derives the rest of the palette from one choice, and twenty-five dials are there for anyone who wants them.
- **It can be changed by saying so.** "Make it calmer", "warmer", "like an old terminal" — the same words work typed.
- **A first run that ends with a working, chosen-looking app** without opening settings once.

### Safety, and being able to undo

- **One decision about every tool call, and its default is to ask.** Allow always saves keystrokes; it does not move the floor. There is a floor no session mode can approve past, and an unanswered question refuses rather than waiting for ever.
- **A conversation can be confined to a directory it cannot write outside of**, chosen per conversation.
- **A write or an edit can be taken back**, to what the file looked like before that turn touched it — that turn, not everything since.

### Setup

- **An agent that needs a login opens one.** Connecting Claude Code showed `claude login` as a line to copy: find a terminal, paste, come back — and the middle step is where people stop. It opens the sign-in in a visible terminal instead. The command is still there, and only appears if that failed.

### Also

- **Read a PDF form, fill a copy, and never touch the original.**
- **One task in, one result out, and an exit code that means it** — the CLI is usable from a script.
- **You can watch the children work** when an agent spawns them.
- **The build machine's account name is out of the shipped binary.**

## 2.3.10

### Setup

- **A Setup tab, first in Settings, with no text fields in it.** Connecting a model used to mean a conversation with the built-in agent, which works and asks you to describe something you have usually already done. It looks at your computer instead and offers one action per row — use it, sign in, or install — never a choice between two, because ranking "sign in" against "install" is not a decision a first-time user can make.
- **No ports, no addresses, no keys typed by hand.** Every address the app needs is already in its own tables. Asking someone for `http://127.0.0.1:20128/v1` is asking them to fail in a way that produces no error at all — just a provider that never lists a model.
- **Claude Code, Codex and Gemini CLI are found if they are there.** So are OmniRoute, LM Studio and Ollama. A gateway that is running with nothing loaded is told apart from one that is not installed, because those need opposite advice and only one of the two mistakes is recoverable.

## 2.3.9

### Fixes

- **The speech engine lets go of your graphics card.** It was stopped only when the app closed or a model was deleted, so a single spoken sentence left a process holding its weights for the rest of the session — gigabytes of graphics memory, on an otherwise idle machine, for nothing. Two minutes without anyone speaking and it unloads now. Speaking again costs one model load, which is the right price for not holding a card hostage.

### Setup

- **A local model recommendation that fits your machine.** "Install LM Studio and load a model" is where local-first quietly fails: the catalogue is thousands of files, and the only way to learn a 14B will not fit in 8 GB is to download twelve gigabytes and watch it fail. The app reads the card and says what fits, leaving room for the window and a speaking voice. These are size calculations, not benchmarks.
- **Connecting Claude Code, Codex or Gemini is one action, not a conversation.** The app looks for the CLI first and offers the single next step — use it, sign in, or install — instead of asking you to describe a setup you have usually already done.

## 2.3.8

### The spoken assistant actually finishing what it starts

- **A conversation no longer breaks after it does something for you.** Running a skill you had taught it left a result in the history with no record of the request it answered, and the model server rejects a whole conversation over that — so the skill worked once and every turn after it failed silently. This was introduced in 2.3.6 and is the cause of "it opens, does the thing, and then stops responding".
- **It no longer hangs up while the agent is still working.** The clock that catches a reply going nowhere was started at the beginning of a turn and only stopped by the first spoken word. Ask for something the assistant hands straight to the agent without speaking first, and two minutes later the conversation was abandoned mid-task. Work in progress now counts as progress.
- **"Yes, I remember — what was it again?" is refused.** The check asked whether anything at all was in the memory, and there usually is; the question that matters is whether _this_ is remembered. Claiming to remember and asking to be reminded in one breath is hollow however full the memory is.

### Fixes

- The notch shows a short line about what is happening, not the assistant's entire reply as it is written. When the agent's own output came through it was rendering raw fragments — a stray backtick, `Command`, `tool`, `for` — one per line, telling you nothing.

## 2.3.7

### Fixes

- The guard that stops the assistant claiming it did something now works on Turkish as it is actually written. Transcription drops the accents constantly — "Simdi caliyor" arrives as often as "Şimdi çalıyor" — and only the accented spellings were being recognised, so for a large share of real turns the guard was simply off.
- A refused sentence is taken off the screen as well as kept out of the speaker. The reply is written out as it is generated, so by the time a sentence can be judged you have already read it, and a lie you read is a lie you believed.

## 2.3.6

### It does the thing, or it says so

- **A taught skill runs the moment you ask for it.** "Play my favourite song" was failing at the last step for a reason that had nothing to do with the skill: it existed, the address was in it, and the only thing in between was the model choosing to reach for it — which it did most of the time. It no longer has a say. The phrase you taught it with runs the skill directly, instantly, with no round trip to think about a decision you already made.
- **It can no longer tell you it has done something it has not done.** Saying "it's playing now" with nothing playing was the worst thing this app did, and the rule forbidding it had been in the assistant's instructions all along. A sentence claiming a finished action, on a turn where no tool ran, is now never spoken at all — it is handed back to the assistant, which gets one more attempt to actually do it.
- **The same for claiming to remember.** "Yes, I remember something — what was it again?" with an empty memory is worse than admitting the blank, because you answer it: you repeat yourself to jog a memory that was never there.
- **And it cannot get out of it by saying it cannot.** Almost nothing you ask for here is impossible — there is an agent that drives the whole machine. Caught having claimed something falsely, it now either does the work or hands the request to that agent. "I can't" is only allowed after something has actually been tried and failed.

### Fixes

- Past conversations are reachable while you are having one. The History tab was offered only when the assistant was idle, which put "what did I say last time" behind ending the conversation you wanted it for.

## 2.3.5

### The spoken assistant

- Spoken conversations are kept. There is a History tab beside the Voice Assistant's settings: every conversation you have out loud is listed there, newest first, and opening one shows the whole transcript — both sides, so you can tell a mis-hearing from a bad answer. Until now a conversation left one summarised line in the memory and everything actually said went with the window.
- Carry on from an earlier one. It opens a new conversation holding the end of the old one, so it knows what "it" and "that one" refer to without answering a question you asked yesterday. The old conversation stays as it was — resuming does not rewrite when things were said.
- Each turn is written down as it is said, not when the conversation ends. A spoken conversation is far more often ended by closing the window than by pressing stop, so a transcript that only existed at the end was usually not there at all. What survives a crash is everything up to the crash.
- Teaching it "play my favourite song" works. It could see the song on your screen and still had no address for it — looking at the screen gives a title, and your browser's address bar is behind this window. It now searches the name, resolves the first result to an address that actually plays, tells you what it found, and saves it only once you agree. The refusal when it has no address says which part is missing, instead of the flat "that is not something the voice can do" that taught it the tool was broken.

### Fixes

- A voice you are not using no longer sits in memory. Every model you had downloaded was loaded at once and held for as long as the app ran — several gigabytes of graphics memory, in Qwen3's case, and choosing a different voice released none of it. Only the voice being spoken with is loaded now, and switching away frees the last one. The first sentence after a switch takes a moment longer, which is the trade.
- Updates now record how fast they arrived. Some machines report the installer coming down at a fraction of their real speed; nothing had ever measured it, so there was nothing to look at. Each download writes its throughput and its source to the log.

## 2.3.4

### The spoken assistant

- Telling it to change something about itself now takes effect in the conversation you said it in. "Switch to a male voice" was heard, written down, agreed to out loud — and then ignored for the rest of the session, because the pipeline took one copy of those settings when it started and never looked again. From where you sit, agreeing and not doing it is worse than refusing.
- A reply that streams and never says anything is no longer allowed to wedge the conversation. The watchdog asked whether the connection was alive; several local models write their whole deliberation into a field that is deliberately never read aloud, and every one of those frames reset it. A model that deliberated for ever left the conversation stuck with nothing on screen. A second clock, armed once a turn and cleared by the first spoken word, catches that without punishing a few seconds of normal thinking.
- A rule you set is obeyed. "Answer me in English even when I speak Turkish" was agreed to and then drifted back a few turns later, because the language setting is written into the prompt as "every reply, every time" and anything you had said arrived earlier and simply lost. Rules come last now, under their own heading, stated as overriding everything above them.
- A rule said in passing binds the conversation it was said in and dies with it. Only one you ask it to remember is written down — so an offhand "in English for this bit" cannot become silently permanent.
- It can be taught things it then does itself. Bind words you say to one concrete action — open an address, open something on the machine — and it happens immediately, with no agent and no wait. The rules for what a taught skill may point at are deliberately narrow: web addresses and absolute paths, and nothing that could carry an argument, chain a command or expand a variable.
- Everything it has taught itself is listed in Settings → Memory, with the actual address or program shown in full. "Opens a page" is not something you can check; the address is. A capability you cannot see is one you cannot withdraw.
- The talk key opens a conversation instead of a single dictated sentence. Press it with nothing running and you are talking to it; while it is running the key is that conversation's microphone, so holding it works from the desktop or from inside another application. It is no longer a toggle — a conversation ends by being asked to stop, not by a key coming up.
- Hand it a file by dropping one on the window. Saying a path out loud is miserable and sending an agent to find it takes minutes and often finds the wrong file. What it holds is a reference, never the contents, so a folder cannot push the conversation out of the prompt. It says so plainly when the provider in use cannot be handed one.

### Updates

- An update installs without an installer window and the app comes back up on its own. You asked for the update a moment earlier; a window telling you a program is being installed is not news.
- And then it says what changed. On the first launch after the version moves, this release's own notes, once. Read from the changelog inside the app rather than from GitHub, because the machine that just came back up may not be online.

### JARVIS

- The display is switched on. It boots when you put it on, the grid drifts, a refresh band crosses the window, the accent breathes at its supply, and a point of light runs the underside of the title bar. The Hub becomes a bay: workspaces on a rack, the one in force lit at its leading edge.
- All of it stops when asked. Anyone who has told their computer they want less motion gets none of it, and the frame's own movement dial does the same — set to calm, the display still resolves once and then holds still.

## 2.3.3

### Features

- Every window can be shaped, not only the Voice Assistant. The chat window, Fool's Hub and the app frame each have their own layout now, with their own presets and their own axes — a level meter is not a question the Hub has an opinion about, so it is not offered one. Every window's default reproduces what the app already drew, so an update rearranges nobody's screen.
- Movements can be built without writing CSS. Choose what moves, how it arrives and how fast; watch it play on a real element, then add it. Movements are saved with the layout and arrive when it is worn. Anyone who has told their computer they want less motion gets none of them, whatever the layout says.
- JARVIS ships as a second workspace: four layouts, its own palette, and a shorter-spoken assistant. It exists to be taken apart — wear it, find something you like, open the editor and it is already there.
- A workspace can carry the palette it was built around, so an arrangement about a look arrives looking like itself instead of like whatever was chosen last.
- Another AI can design a layout for you. Copy the app's own instructions into whichever assistant you already use, describe the look you want, then drop the answer onto the layout editor or paste it in. The app never holds a key and never sends anything anywhere. What comes back is read the way a shared workspace is: unknown values dropped, and the file never allowed to overwrite something you made.
- Changing a layout by voice reaches every window. "Put the list one on" is a sentence about the Hub, and you no longer have to say which window you meant.

### Fixes

- Choosing a palette no longer undoes the layout dials. A theme's stylesheet was applied after them, so picking one straightened corners somebody had rounded — and a workspace bringing a palette with it would have undone its own layout on the way in.
- Deleting a layout you were wearing puts back that window's own default. It used to put the Voice Assistant's shape on whichever window you were editing.

## 2.3.2

### Fixes

- The Voice Assistant no longer stops answering. Asking something while it was still talking put the question in a single slot: it was never shown, a second question overwrote the first, and interrupting the reply threw away whatever was waiting. Questions now queue in order, appear the moment they are heard, and are answered whether the reply they waited on finished or was cut short.
- Underneath that, nothing bounded a turn. A model server that accepted a request and then stopped sending left the conversation wedged for the rest of the session — every later question shown once, replaced, and answered never. A turn that makes no progress for forty-five seconds is now abandoned out loud and the conversation carries on. A model that reasons for a while before its first word is left alone.
- Scanning the QR code to carry on from a phone works. The code used to fall back to this computer's own address whenever there was no network one, which no phone can ever reach, and the settings panel could believe remote access was off while it was on — hiding the QR section entirely. It refuses rather than falling back now, and says which of the three things is missing.
- Windows blocks incoming connections by default and no rule for The Fool has ever existed, so even a correct QR code reached a port nothing was allowed to talk to. The WebUI panel says so and shows the exact command, scoped to private networks. Changing the firewall stays your decision.

## 2.3.1

### Addons

- A workspace can declare capabilities the app does not have on its own — pitch detection, audio decoding, anything that needs a real library rather than a model thinking harder. An addon is an MCP server, so it plugs into the extension point that was already there and nothing about the backend changes.
- Its page calls one directly: a function and a result in a second, with no model in the loop. That is the difference between an addon and handing the job to the agent.
- Installed, an addon becomes an ordinary server in Settings → Tools — visible, switchable, removable, and usable by everything else on the machine.
- Nothing is installed without you seeing it. An imported workspace that wants an addon shows the actual command line first; declining still opens the workspace, with the parts that need it switched off.
- Asking for something built out loud can now declare the capability it needs, so the requirement travels with the workspace instead of being something the next person has to work out.

## 2.3.0

### Fool's Hub, and workspaces

- A workspace is the whole app aimed at one purpose: the layout, who the assistant is being, which agent and model do the work, all under a name. Switching applies every one of them at once. What you had before this is the `default` workspace, unchanged.
- Arrange the app the way you want it, then keep it — a workspace is taken from how things already are rather than retyped into a form.
- Workspaces are files. Send one to somebody and they get the arrangement, not your account: agents and models are named by id and no key is ever written into one. A file that is not a workspace is refused rather than quietly rearranging the app.
- Switch by saying so: "put me in the guitar one", "back to default".

### A workspace can be a thing, not just a set of settings

- Ask for something and it is built: "make me something that turns a YouTube link into guitar tab" writes a real page, keeps it in a workspace, and moves you into it. It runs inside The Fool rather than in a browser tab beside it.
- Those pages have the whole application behind them. Fetching, reading, transcribing, calling a model, driving the machine — all through the agent you already have, with your own models and keys. They carry no server of their own, which is what makes one safe to send to somebody else.
- A shared workspace brings its page with it, so what arrives works rather than half-works.

### Making the interface yours

- A new Layout section: corners, spacing, text size, motion, accent reach and depth, as sliders with a live preview. The app wears the change as you turn it, and saving is what gives an arrangement a name.
- The Voice Assistant has a second shape to choose — a HUD, with the level wrapped into a ring — beside the column it has always had. The one that ships stays the default; no update rearranges a screen nobody asked to have rearranged.
- Every state of a conversation now moves differently. Connecting, thinking and working used to be one flat line with three different words under it.

### Memory you can read and correct

- What the assistant remembers is two markdown documents in Settings → Memory: `user.md` for who you are and what your own words mean, `agent.md` for what it got wrong and the ways of doing things you taught it. Both are yours to edit, and both are read by every agent working on your behalf — not only by the voice.
- Teach it a skill by explaining it, or by showing it: it can watch your screen while you demonstrate, then write and install a real skill in your library. Recording starts and stops on your word and stops itself after six minutes.
- Searching inside a site is now instant rather than minutes of an agent clicking: "open YouTube and find that song" is one step.
- A conversation is remembered on every provider, not only the local one.

### Fixes

- The agent activity list no longer spells out the answer letter by letter, on the page or on the notch. It shows steps, and moves once a sentence finishes.
- Voice Chat is now called Voice Assistant.

## 2.2.55

### Agentic voice conversation

- A spoken conversation now survives leaving the Voice Chat page. Opening the chat the assistant just created, answering a permission request, or looking at anything else in the app no longer closes the microphone and abandons the reply.
- The notch keeps the request on screen for the whole turn instead of clearing it the moment transcription ended, and shows the agent's work step by step rather than overwriting one line, so a long task can be told apart from a stuck one.
- The assistant decides for itself when it needs to look at the screen. "What does this error mean" and "what does it say here" are about something the user can see, and it now looks before answering instead of describing a screen it never opened.
- Asking it to build something builds it and opens it: the work goes to the agent, the result is served locally, and the user's own browser opens on it. A build that finishes with nothing to show is reported as a failure rather than an empty tab.
- Settings can be changed by saying so — the voice, faster or slower, louder, the language of replies, hold-to-talk, acting without asking, the interrupt word, the wake phrase, and which models think and see.
- The assistant knows the app it belongs to: what each settings page is for, what the notch and hold-to-talk are, and where things live — and is told to say when it does not know rather than inventing a menu.

### It remembers you

- On the first conversation it asks what to call you, keeps the answer, and uses it from the next sentence. Saying "call me something else" later changes it for good.
- Things you tell it about yourself are kept between sessions, along with a short record of each recent conversation, so it opens knowing who it is talking to instead of starting as a stranger every time.
- What is remembered can be dropped by asking. It is stored locally like the rest of the voice settings.

### Voices

- Added Supertonic 3: the fastest and smallest voice in the catalogue, measured at 0.06-0.26 s a sentence on a graphics card — sixteen to seventy-six times faster than the audio plays — in 575 MiB of memory, and still faster than real time on a processor, so it needs no GPU download.
- It carries ten voices, five male and five female, which is what makes asking for a male or a female voice out loud work.
- It speaks real Turkish. Rendered and transcribed back, a Turkish sentence returns word for word with its diacritics, which no other engine in the catalogue manages.

## 2.2.54

### Mobile access

- Fixed the QR login page to send the token field expected by the authentication endpoint, so phones can complete mobile pairing.

### Release packaging

- Routed desktop and web release jobs through the checked-in FoolCore source builder instead of missing helper files.
- Made clean CI runners build locked dependencies and generate the managed runtime bundle required by installers.

## 2.2.53

### Agentic voice conversation

- Added a dedicated animated voice conversation surface with low-latency realtime audio, interruption handling and visible agent activity.
- Voice turns can execute tools and return their results inside the same conversation instead of stopping at transcription or playback.
- Added a supervised local speech-to-speech runtime and hardened realtime session setup so connection failures surface clearly.

### First-run setup and built-ins

- Added a first-run provider setup flow for Codex and Claude, with The Jester available to guide configuration.
- Added built-in shared-memory and visual-companion skills so assistants can retain user-approved context and request interactive visual feedback.
- Kept all new surfaces aligned with the existing theme tokens and internationalised the new user-facing controls.

### Mobile access and packaging

- Fixed QR/mobile access to prefer a reachable LAN address instead of link-local or virtual-adapter addresses.
- Made release asset preparation resolve version metadata without depending on Node when CI already provides release metadata.
- Made the Windows release packaging test select Git Bash explicitly, preventing WSL path translation from creating stray build artifacts.

## 2.2.52

### The Jester can theme the app for real

- **A theme it creates and applies now actually applies.** Creating a theme and selecting it is one write, and the app told its listeners about each key as it landed rather than after the batch. So the theme listener resolved the new `activeId` against a list of themes that did not contain it yet, found nothing, and fell back to Light — which looks exactly like the write never happening. It also never appeared in Settings → Appearance for the same reason.
- A theme that would hide the window is refused before it is saved, and the rules for writing a safe one are now part of what the Jester knows.

### Voice

- **Region capture no longer leaves the microphone open.** Push-to-talk is a toggle; the capture gesture handled the second tap without closing the turn its own press had opened, so the microphone stayed live and every gesture afterwards was inverted.
- **Permission requests appear in the notch**, answerable with 1, 2 and 3. Holding right Ctrl starts a turn from wherever you are looking, which is usually not this app — a request that only ever showed in the main window stalled the turn with nothing on screen to explain it.
- **Right Ctrl + V switches off always-on listening.** The combination is watched, never claimed: paste keeps working everywhere, and the gesture does nothing at all when the wake word is not listening.

### The browser, for agents

- An agent can drive the built-in browser panel: open pages, read them, click, type, go back and forward. It is the browser you can see, with your sessions in it, so it ships switched on for nobody and every tool call still asks.

## 2.2.51

### A theme can no longer hide the app

Adding a theme with unlucky CSS made the window go blank — and the settings
screen that would have undone it went with it, so there was nothing left to
click. Theme CSS is injected with `!important` on every declaration, which is
what lets a theme restyle the app at all and also what let one rule beat
everything the app had to say about being visible.

- Rules that would hide the whole window are dropped before the stylesheet is
  applied — hiding declarations aimed at `html`, `body`, `*`, `:root` or
  `#root`. The rest of the rule is kept, so a theme that hides the app and also
  sets a background keeps its background.
- A safety net is applied after every theme, pinning the document and the app
  root visible, for anything phrased in a way the check did not anticipate.
- **Right-click the tray icon → Reset theme** puts the appearance back to the
  default and clears every colour override, without deleting the themes you have
  made. It is in the tray because that is the one surface still working when the
  window is not.
- The Jester is told the rules, so the themes it writes stay applicable.

### The Jester

- It can now act on the app rather than only describe it: build, apply and
  delete themes, research an MCP server and install it, find and import skills,
  and use the browser.
- **Built-in MCP servers reach the agent.** The chrome-devtools and
  image-generation servers the app ships were skipped on the way to the agent
  and nothing else added them — the switch in settings was real and had no
  effect. Both still ship disabled; turning one on now does something.

## 2.2.50

The first release under this name. It carries the desktop app and the backend in one repository, adds a voice layer that was not in the upstream project, and moves every piece of the product identity — data folder, binaries, protocol handler, update feed — off the upstream name.

### Voice

A full local speech stack, none of which existed upstream.

- **Speak and be heard.** Local and OpenAI-compatible STT/TTS, with built-in Kokoro, Piper and ZipVoice voices, plus voice cloning from a reference clip.
- **Hands-free.** A configurable wake phrase, always-on wake listening with a tray switch, push-to-talk from any window, and voice activity detection that decides when you have stopped speaking.
- **Spoken briefings, not transcripts.** Replies are summarised into short spoken English rather than read out as raw code and tool output.
- **The caption window.** A desktop overlay showing the running conversation, pinned to one chat so a spoken turn goes where you expect.
- **Screen-aware turns.** When the model can see images, a spoken turn can carry the current screen with it.
- Playback routes to the speaker you pick, and speech engines get thread counts measured per role rather than guessed.

### Local models

- LM Studio's installed models are read directly and published to the model picker — no manual entry.

### Appearance

- The Fool identity across the logo, the desktop pet and the theme controls, with a boot splash while the window loads.
- Live colour and corner-radius customisation, wired so the pickers actually repaint the running app.
- The pet's animations rebuilt on one shared motion language.

### Identity and packaging

- The backend is compiled from source in this repository instead of downloaded from another organisation's releases.
- The built-in agent ships as The Fool CLI; the built-in assistant is The Jester.
- Data lives under this product's own folder; the protocol handler, installer, executable and app id all carry this name.
- Updates are checked against and downloaded from this repository.
- Closing the window asks once whether to keep running in the tray, then remembers the answer.

### Seeing the screen

- **A pasted screenshot reaches the model.** It never became an image part before: attachments arrived as a list of file paths, and the tool that could have opened them was withheld from every model not named in the built-in catalogue — including vision-capable ones. Images now travel as images.
- **Capture the screen, or part of it.** Two quick taps on right Ctrl dim the screen and let you drag a box around anything; what you draw lands in the composer as an attachment, ready for the question you were going to ask about it. Holding the same key still starts a spoken turn, and `RightCtrl+C` still copies.
- The screenshot that goes with a spoken turn can now be of the whole display rather than only the app window. Off by default.

### Skills

- **An assistant's skills reach the agent.** They did not before — the names were configured, stored and displayed, and never loaded, so an assistant switched on for one skill was running with none.
- The shared skill set now reaches every agent and every model, rather than only the ones that asked for it by name.
- The Jester learns the application from the application: a new built-in skill points it at what this build actually supports, so features added later are discovered rather than remembered.

### Performance

- Conversation diffs are no longer re-parsed on every streamed chunk.

### Building from source

- `buildFoolcore.js` no longer stops on a bundle that is not in the repository and cannot be built from it. A source download now reaches a running app with `bun install`, one backend build, and `bun run dev`.
