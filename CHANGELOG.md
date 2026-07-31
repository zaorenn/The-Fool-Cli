# Changelog

The Fool is a fork of [AionUi](https://github.com/iOfficeAI/AionUi) (Apache-2.0). Release history from before the fork lives in that project; this file records what has changed here.

## 2.1.43 — unreleased

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

### Performance

- Conversation diffs are no longer re-parsed on every streamed chunk.
