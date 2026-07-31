# The Fool Windows Alpha Design

**Date:** 2026-07-29  
**Status:** Approved for specification; implementation requires written-spec review  
**Base:** The Fool v2.1.43  
**Target:** Windows 10/11 x64

## 1. Objective

Build a usable Windows-first alpha of **The Fool** by rebranding and extending The Fool. The product
must be a general-purpose, voice-first desktop agent that can use OpenClaw, Hermes Agent, and other
ACP-compatible CLIs without making voice, memory, or presentation depend on any one agent.

The alpha is complete only when a Windows user can install and launch The Fool, say the configured
wake phrase, speak naturally until a pause, route the resulting request to an agent, observe its
work, hear a concise and truthful spoken account of the result, and continue the conversation.
The same running desktop instance must be controllable from a phone on the same trusted local
network.

This repository is intentionally separate from the existing `C:\Fool` project. That project and
its uncommitted work remain untouched.

## 2. Product Principles

1. **Voice belongs to The Fool, not the agent.** Switching from OpenClaw to Hermes or another ACP
   agent must not change microphone, wake-word, STT, TTS, or voice-profile behavior.
2. **The screen and the voice serve different purposes.** The screen shows complete tool activity,
   code, diffs, logs, and detailed answers. Speech gives a natural, concise, fact-preserving account.
3. **Local-first and explicit.** Local speech providers are first-class. Cloud use is labeled before
   data leaves the machine, and microphone state is continuously visible.
4. **Learning is inspectable.** The Fool stores user-approved preferences, corrections, and lessons.
   It does not silently retrain a model or rewrite its own governing instructions.
5. **Alpha means usable, not simulated.** Unsupported capabilities are disabled with an explanation;
   no placeholder model, fake health state, or non-functional button ships.
6. **Upstream remains mergeable.** New domains are isolated behind typed boundaries and the
   rebrand is centralized so The Fool updates can be evaluated and merged deliberately.

## 3. Alpha Scope

### 3.1 Included

- Complete The Fool identity for the desktop app, Windows packaging, tray, WebUI, and PWA metadata.
- A default dark theme derived from the supplied jester-mask identity.
- Windows microphone and speaker selection.
- Push-to-talk and hands-free conversation.
- Voice activity detection (VAD) and end-of-utterance detection.
- A functional, configurable “Hey Fool” wake word in a quiet indoor environment.
- Provider-based STT and TTS with at least one verified local path and one verified
  OpenAI-compatible path.
- Streaming or low-latency speech playback where supported.
- Interruption: user speech stops current playback and starts the next turn.
- A dedicated Voice settings surface with model, device, provider, voice, health, privacy, and test
  controls.
- Capability-based voice cloning when a legally usable provider works reliably on the target
  machine.
- Agent-independent spoken narration that does not read code, diffs, tables, URLs, or raw logs.
- Detection and use of installed OpenClaw, Hermes Agent, and other supported ACP CLIs.
- Agent-independent local memory for preferences, corrections, and approved lessons.
- Rebranded responsive WebUI usable from a phone on the same LAN with authentication.
- Windows x64 installable alpha package.

### 3.2 Excluded from the alpha

- Public-internet exposure of the WebUI.
- Mobile native applications.
- Windows code signing and automatic public updates.
- Guaranteed wake-word accuracy in noisy rooms or across arbitrary microphones.
- Training or fine-tuning model weights.
- Cloning a third party’s voice without documented authorization.
- Production support guarantees or enterprise multi-user administration.

## 4. Architecture

The existing Electron main/renderer separation remains intact. Renderer code uses browser APIs and
typed IPC only. Device access, model processes, credentials, persistence, and provider orchestration
live in the main process.

```text
Windows audio devices
        |
        v
Fool Voice Engine (Electron main process)
  - device lifecycle
  - wake word
  - VAD / turn detection
  - STT provider registry
  - TTS provider registry
  - playback / interruption
        |
        v
Fool Conversation Router
  - active session
  - active ACP agent
  - structured activity stream
        |
        +--> OpenClaw
        +--> Hermes Agent
        +--> other ACP CLIs
        |
        v
Fool Voice Narrator
  - deterministic content filtering
  - verified outcome extraction
  - short natural spoken brief
        |
        v
TTS provider -> Windows speaker
```

Shared types describe providers, capabilities, health states, model metadata, download progress,
voice profiles, audio state, narration input, and narration output. Main-to-renderer calls pass
through the existing preload and bridge conventions.

## 5. Rebranding and Default Theme

### 5.1 Identity

The product name, package metadata, executable labels, window titles, installer metadata, shortcuts,
tray labels, PWA manifest, browser titles, default avatars, onboarding, About surface, and update
copy change to **The Fool**.

AionUi’s Apache-2.0 license and required attribution remain available in the legal notices. AionUi
trademarks and product links are not presented as The Fool features.

The supplied JPEG is source reference material, not a production icon. It will be converted into:

- a simplified master mark,
- Windows multi-resolution ICO assets,
- a monochrome tray mark,
- splash/loading art,
- PWA icons,
- a compact mask mark that remains legible at 16–24 px.

### 5.2 Visual language

The default theme uses semantic tokens:

- near-black onyx background,
- dark graphite surfaces,
- restrained crimson primary accent,
- warm white primary text,
- muted neutral secondary text,
- accessible green success and amber warning states.

The jester motif appears in identity, state transitions, and small accents. Work surfaces remain
quiet and readable. The design avoids decorative glow, noisy carnival patterns, and perpetual idle
animation.

The mask indicates real voice state: idle, wake detected, listening, thinking, speaking, muted, and
error. Animation stops when no state change is occurring.

## 6. Fool Voice

### 6.1 Provider contracts

Voice providers are registered through typed contracts rather than conditionals spread through UI
code.

```text
STTProvider
  listModels, installModel, removeModel, transcribe, healthCheck

TTSProvider
  listModels, listVoices, synthesize, stream, healthCheck
  optional: createVoiceProfile, deleteVoiceProfile

WakeWordProvider
  listModels, activate, deactivate, setSensitivity, healthCheck
```

Provider capabilities determine which controls are visible. A TTS provider that cannot clone voices
does not expose cloning controls. A non-streaming provider uses buffered playback without claiming
streaming support.

### 6.2 Turn lifecycle

```text
IDLE -> WAKE_DETECTED -> LISTENING -> TRANSCRIBING -> AGENT_RUNNING
     -> NARRATING -> SPEAKING -> IDLE
```

Any state can move to `MUTED`, `CANCELLED`, or `ERROR`. Device changes cancel the active capture,
release the previous device, and reinitialize explicitly. Closing Talk mode terminates capture and
playback resources.

VAD detects speech and a configurable silence window ends the utterance. While The Fool is
speaking, detected user speech cancels queued audio before opening the next turn. The cancellation
is recorded so the session knows the previous spoken answer was interrupted.

### 6.3 Settings

The Voice settings page provides:

- microphone and speaker selectors,
- live input level and microphone test,
- push-to-talk shortcut,
- Talk mode and wake-word toggles,
- wake-word model and sensitivity,
- VAD silence timeout,
- STT provider, endpoint, model, language, and local model management,
- TTS provider, endpoint, model, voice, speed, and volume,
- provider and model health checks,
- sample transcription and voice preview,
- cloud/local privacy labels,
- voice-profile creation, preview, rename, and deletion when supported,
- per-agent voice overrides with a global default.

Secrets use the application’s existing secure settings conventions and never appear in logs or
renderer persistence.

### 6.4 Voice cloning

Voice cloning is conditional on a provider that satisfies all of the following during the
implementation spike:

- compatible with Windows x64,
- acceptable licensing for a publishable derivative application,
- stable on the target hardware,
- usable latency and intelligibility,
- explicit user authorization workflow,
- deletable local reference samples and generated profiles.

If no provider satisfies the criteria, the provider interface remains extensible but the alpha does
not show a fake cloning workflow.

## 7. Fool Voice Narrator

The narrator receives structured run evidence, not only the assistant’s Markdown.

```text
NarrationInput
  - user request
  - final agent answer
  - completed and failed tool calls
  - changed-file summaries
  - test and validation outcomes
  - unresolved errors
  - required user decision

NarrationOutput
  - spokenText
  - source fact references
  - confidence / fallback reason
```

Before model-based narration, deterministic normalization removes or transforms:

- fenced and inline code,
- raw diffs,
- terminal logs,
- Markdown syntax,
- tables,
- long URLs and hashes,
- repetitive tool telemetry.

The narrator then produces a short spoken brief describing what happened, what was verified, what
failed, and what the user must decide next. It must not claim a test passed unless the structured
run evidence says it passed. If narration fails, The Fool speaks a deterministic cleaned final
answer rather than inventing a result.

Examples:

- Display: full patch, two test commands, and detailed explanation.
- Speech: “I fixed the login validation in two files. The targeted tests pass. I left the unrelated
  formatting warnings unchanged.”

The user can ask for more detail, in which case a second spoken brief expands selected facts without
reading raw code.

## 8. Agent Integration

The Fool’s ACP session management remains the transport foundation. The Fool detects installed agents
and exposes configured custom ACP agents.

Required alpha checks:

- installed OpenClaw can start or connect and complete a real general-purpose task,
- installed Hermes Agent can start through ACP and complete a real turn,
- switching agents does not restart or reconfigure Fool Voice,
- permission requests remain visible and actionable,
- code-oriented runs show tool activity, changed files, diffs, and test results,
- narration describes the verified outcome rather than reading the displayed artifacts.

The Fool does not import OpenClaw’s STT/TTS configuration as its own voice engine. OpenClaw remains
an agent target only.

## 9. Fool Memory

Fool Memory is shared across agent choices and stored locally in the existing application database.
Alpha memory records are typed:

- user preference,
- user correction,
- project fact,
- successful procedure,
- failure lesson.

Every record includes provenance, creation time, last-use time, scope, and enabled state. Users can
view, edit, disable, and delete records.

The alpha learning loop is:

```text
run result or user correction
  -> candidate lesson
  -> explicit user approval
  -> local memory
  -> relevance lookup on a future turn
  -> bounded context supplied to the selected agent
```

Automatic silent writes are excluded. Agent-specific private memory may continue to work, but it
does not replace Fool Memory.

## 10. Phone Control

The existing WebUI is rebranded and made responsive for the required mobile flows:

- authenticate,
- view conversations and active runs,
- send text,
- capture a voice message through the phone browser,
- choose an agent,
- approve or deny a pending action,
- see concise run status and final result.

Alpha access binds only to a user-selected LAN interface and requires authentication. The desktop
shows the local URL and a QR code. The default remains local-only. The application does not open a
router port, configure public DNS, or expose the service to the internet.

Desktop Fool Voice remains on the Windows machine. Phone microphone input is transmitted as an
authenticated turn to the desktop voice pipeline; the phone is a remote control, not a second agent
runtime.

## 11. Error Handling and Observability

- Every voice stage has a typed unavailable, degraded, busy, cancelled, or failed state.
- Provider health failures name the provider and corrective action without leaking credentials.
- Model downloads are resumable or cleanly restartable and show measured progress.
- Device loss releases capture resources and prompts for a replacement.
- Agent failure never produces a success narration.
- Narrator failure falls back to deterministic sanitized speech.
- Phone disconnection does not terminate the desktop agent run.
- Logs record timing and state transitions, not raw microphone audio or secrets.
- Users can export a diagnostics bundle after reviewing its contents.

## 12. Verification and Alpha Acceptance

The alpha is accepted only after all applicable repository checks and the following real Windows
flows pass:

1. A clean Windows x64 package installs and opens as The Fool.
2. No primary product surface presents The Fool branding as the product identity.
3. The supplied visual identity is legible in the window, installer, taskbar, tray, and phone PWA.
4. Microphone and speaker can be selected and tested.
5. “Hey Fool” starts listening in a quiet indoor environment.
6. Natural Turkish speech ends after a pause and produces an accurate editable transcript.
7. A request reaches OpenClaw and produces a real response.
8. A request reaches Hermes through ACP and produces a real response.
9. Switching between those agents leaves voice configuration intact.
10. The Fool speaks a concise account of work and does not read displayed code or raw logs.
11. Speaking during playback stops it and begins a new turn.
12. A user-approved correction appears in Fool Memory, affects a relevant later turn, and can be
    deleted.
13. A phone on the same LAN authenticates, sends a task, observes progress, and resolves a
    permission request.
14. A representative code task produces a visible diff and test result while speech reports the
    verified outcome.
15. Unit, integration, i18n, type, lint, formatting, and Windows build checks pass.
16. Known alpha limitations and any optional capability not enabled, including voice cloning, are
    documented honestly.

## 13. Implementation Sequence

1. Establish the clean The Fool baseline: dependencies, tests, development launch, Windows package.
2. Centralize product identity and implement The Fool theme and assets.
3. Add typed voice contracts, IPC, persistence, and device lifecycle.
4. Implement one local and one OpenAI-compatible STT/TTS path.
5. Implement VAD, wake word, Talk state machine, playback, and interruption.
6. Build Voice settings and model/provider management.
7. Add structured activity-to-narration conversion and fallback behavior.
8. Verify OpenClaw, Hermes, and agent switching through real ACP sessions.
9. Add shared memory candidates, approval, retrieval, and management UI.
10. Rebrand and verify authenticated LAN phone control.
11. Build the Windows package and execute the complete acceptance matrix.

Each implementation step begins with a failing focused test where practical and ends with targeted
verification. A working baseline is preserved between steps. Voice cloning is attempted only after
the core conversational loop, narration, and agent routing are working.

## 14. Delivery

The delivery consists of:

- the separate The Fool source repository based on The Fool,
- committed design and implementation documentation,
- a Windows x64 alpha installer or package,
- generated branding assets,
- verified provider/model defaults,
- test and build evidence,
- an Alpha limitations document,
- no modification to the existing `C:\Fool` repository.
