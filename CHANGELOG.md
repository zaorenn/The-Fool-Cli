# Changelog

The Fool is a fork of [AionUi](https://github.com/iOfficeAI/AionUi) (Apache-2.0). Release history from before the fork lives in that project; this file records what has changed here.

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
