# Changelog

The Fool is a fork of [AionUi](https://github.com/iOfficeAI/AionUi) (Apache-2.0). Release history from before the fork lives in that project; this file records what has changed here.

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
