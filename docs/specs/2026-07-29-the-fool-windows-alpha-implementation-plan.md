# The Fool Windows Alpha Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a Windows 10/11 x64 installable alpha of The Fool with complete product branding, a dark crimson default theme, agent-independent local/cloud voice, natural spoken run briefs, ACP agent routing, inspectable local memory, and authenticated LAN phone control.

**Architecture:** Keep AionUi's Electron renderer/main and AionCore boundaries intact. Audio capture, VAD, playback, and visible voice state live in the renderer; native local inference, model files, downloads, and memory persistence live in isolated Electron main-process services reached through the existing typed bridge. The active conversation remains AionCore/ACP-owned, so OpenClaw, Hermes, and other ACP agents share the same Fool Voice and Fool Memory layers.

**Tech Stack:** Electron 37, React 19, TypeScript 5.8 strict mode, Arco Design, UnoCSS, Vitest 4, Playwright, `sherpa-onnx-node`, `better-sqlite3`, `sharp`, `qrcode.react`, electron-builder/NSIS.

## Global Constraints

- Work only in `C:\Fool-AionUI` on `feat/the-fool-windows-alpha`; never modify `C:\Fool`.
- Preserve Apache-2.0 headers, upstream attribution, and third-party notices.
- Do not rename internal AionCore protocol fields or `AIONUI_*` compatibility environment variables in this alpha.
- Keep each source directory at ten or fewer direct children and follow `AGENTS.md`.
- Use Arco components for interactive UI and semantic theme tokens outside theme preset files.
- Add every user-visible key to all languages listed by `packages/desktop/src/common/config/i18n-config.json`.
- Begin each behavior change with a focused failing test and include at least one failure path per `describe`.
- Do not expose microphone audio, API keys, bearer tokens, or raw memory contents in logs.
- Disable unsupported capability controls. Voice cloning remains hidden unless a provider passes the licensing, health, latency, and deletion checks in Task 10.
- Do not push, publish a GitHub release, or alter upstream remotes without explicit user approval.

---

## Task 1: Establish and Record the Reproducible Baseline

**Files:**

- Modify: `README.md`
- Create: `docs/testing/the-fool-alpha-baseline.md`
- Verify: `package.json`
- Verify: `bun.lock`

- [x] Install Bun on the workstation, then record `node --version`, `bun --version`, `rustc --version`, `openclaw --version`, and `hermes --version` in `docs/testing/the-fool-alpha-baseline.md`.
- [x] Run `bun install` and verify that the lockfile is unchanged before feature dependencies are added.
- [x] Run `bun run test`, `bunx tsc --noEmit`, and `bun run package`; record command, exit code, duration, and any upstream-only failures.
- [x] Run `bun run build-win:x64:fast` and record the unmodified AionUi artifact path and whether Windows Defender or file locking affects the build.
- [x] Add a concise "The Fool alpha development" section to `README.md` with the branch, Windows prerequisites, and exact validation commands.
- [x] Commit with `docs(build): record The Fool alpha baseline`.

## Task 2: Centralize Product Identity and Generate Production Assets

**Files:**

- Create: `packages/desktop/src/common/brand.ts`
- Create: `scripts/generate-fool-brand-assets.ts`
- Create: `packages/desktop/resources/brand/fool-mask-master.png`
- Create: `packages/desktop/resources/brand/fool-tray-master.png`
- Modify: `package.json`
- Modify: `packages/desktop/package.json`
- Modify: `packages/desktop/electron-builder.yml`
- Modify: `packages/desktop/src/renderer/index.html`
- Modify: `packages/desktop/src/process/utils/tray.ts`
- Modify: `packages/desktop/src/renderer/components/layout/Layout.tsx`
- Modify: `packages/desktop/src/renderer/components/layout/Titlebar/index.tsx`
- Modify: `packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx`
- Test: `tests/unit/common/brand.test.ts`
- Test: `tests/unit/process/trayToggle.test.ts`
- Test: `tests/integration/branding-metadata.test.ts`

- [x] Write failing tests asserting `PRODUCT_NAME === 'The Fool'`, `PRODUCT_SLUG === 'the-fool'`, installer metadata uses The Fool, and primary UI files import centralized brand values instead of hard-coding AionUi.
- [x] Use the approved jester-mask JPEG as an image-generation reference to create a transparent, simplified crimson/white/onyx master mark and a single-color tray mark; visually inspect both at full size and 24 px.
- [x] Add `png-to-ico` as a development dependency and implement `scripts/generate-fool-brand-assets.ts` using `sharp` to emit deterministic 16, 24, 32, 48, 64, 128, 192, 256, and 512 px PNGs plus `resources/app.ico`.
- [x] Add `packages/desktop/src/common/brand.ts` with product name, short name, slug, protocol label, legal attribution, and neutral support/update states; do not invent a The Fool website or repository URL.
- [x] Change package, Electron builder, NSIS, executable, shortcut, protocol, browser title, tray tooltip, visible layout wordmark, and About identity to The Fool.
- [x] Keep "Based on AionUi — Apache-2.0" in About/legal notices and disable upstream auto-update actions for this private alpha.
- [x] Run the brand asset generator, the three targeted tests, `bun run format`, and `bunx tsc --noEmit`.
- [x] Commit with `feat(brand): establish The Fool product identity`.

## Task 3: Make the Fool Dark Theme the Default

**Files:**

- Create: `packages/desktop/src/renderer/pages/settings/AppearanceSettings/presets/the-fool.css`
- Create: `packages/desktop/src/renderer/assets/themes/the-fool-theme.png`
- Modify: `packages/desktop/src/common/theme/constants.ts`
- Modify: `packages/desktop/src/renderer/theme/builtinThemes.ts`
- Modify: `packages/desktop/src/renderer/pages/settings/AppearanceSettings/presets.ts`
- Modify: `packages/desktop/src/renderer/pages/settings/AppearanceSettings/themeCovers.ts`
- Modify: `packages/desktop/src/renderer/styles/themes/default-color-scheme.css`
- Test: `tests/unit/renderer/theme/theFoolTheme.test.ts`
- Test: `tests/e2e/cases/branding/the-fool-theme.e2e.ts`

- [ ] Write a failing unit test asserting the default theme ID is `the-fool`, appearance is dark, and required semantic tokens exist.
- [ ] Define onyx backgrounds, graphite surfaces, restrained crimson primary/brand colors, warm-white text, accessible success green, and warning amber in `the-fool.css`.
- [ ] Register The Fool first in `BUILTIN_THEMES`, make it `DEFAULT_THEME_ID`, and preserve existing themes as opt-in choices.
- [ ] Add a theme cover generated from the master mark without decorative glow or noisy patterns.
- [ ] Add an E2E assertion for `data-theme="dark"`, the The Fool wordmark, primary token application, and readable chat/send-box surfaces.
- [ ] Run targeted theme tests, `bun run lint:fix`, `bun run format`, and `bunx tsc --noEmit`.
- [ ] Commit with `feat(theme): add The Fool default appearance`.

## Task 4: Define Voice Contracts, Settings, and Typed Bridges

**Files:**

- Create: `packages/desktop/src/common/types/foolVoice.ts`
- Modify: `packages/desktop/src/common/types/provider/speech.ts`
- Modify: `packages/desktop/src/common/config/clientSettings.ts`
- Modify: `packages/desktop/src/common/config/configMigration.ts`
- Modify: `packages/desktop/src/common/config/storage.ts`
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts`
- Create: `packages/desktop/src/process/bridge/foolVoiceBridge.ts`
- Modify: `packages/desktop/src/process/bridge/index.ts`
- Test: `tests/unit/common/foolVoiceTypes.test.ts`
- Test: `tests/integration/process/foolVoiceBridge.test.ts`

- [ ] Write failing contract tests for provider capability narrowing, settings validation, default Turkish configuration, and invalid state transitions.
- [ ] Define `VoiceProviderKind`, `VoiceCapability`, `VoiceModel`, `VoiceProfile`, `VoiceHealth`, `VoiceDownloadProgress`, `FoolVoiceSettings`, `VoiceTurnState`, `NarrationInput`, and `NarrationOutput`.
- [ ] Extend STT providers with `local-sherpa` while retaining existing `openai` and `deepgram` compatibility.
- [ ] Add settings keys for devices, VAD, wake phrase, STT, TTS, narrator, playback, and per-agent overrides with safe migrations from `tools.speechToText`.
- [ ] Add typed `foolVoice` providers/events for catalog, download, remove, health, transcribe, synthesize, cancellation, and download progress.
- [ ] Register a bridge shell that returns explicit `unavailable` health until services are introduced in Task 6; never report fake readiness.
- [ ] Run contract and bridge tests, `bun run format`, and `bunx tsc --noEmit`.
- [ ] Commit with `feat(voice): define independent voice contracts`.

## Task 5: Implement Resumable Voice Model Management

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Create: `packages/desktop/src/process/services/fool-voice/VoiceModelCatalog.ts`
- Create: `packages/desktop/src/process/services/fool-voice/VoiceModelManager.ts`
- Create: `packages/desktop/src/process/services/fool-voice/archive.ts`
- Create: `packages/desktop/src/process/services/fool-voice/index.ts`
- Modify: `packages/desktop/electron-builder.yml`
- Test: `tests/unit/process/foolVoiceModelCatalog.test.ts`
- Test: `tests/integration/process/foolVoiceModelManager.test.ts`

- [ ] Add pinned `sherpa-onnx-node` and extraction dependencies compatible with Node 22/Electron Windows x64.
- [ ] Write failing catalog tests for these official assets: multilingual Whisper tiny int8 STT, Supertonic 3 int8 TTS with Turkish and ten speakers, and their required file manifests.
- [ ] Write failing model-manager tests for partial-download resume, server-without-range restart, cancellation, invalid archive cleanup, path traversal rejection, and missing-file health.
- [ ] Implement a static signed-source catalog using only official `k2-fsa/sherpa-onnx` release URLs:
  - `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2`
  - `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2`
- [ ] Store models under `<userData>/fool/models/<provider>/<model-id>`, downloads under `<userData>/fool/downloads`, and progress as measured bytes.
- [ ] Implement atomic extraction and manifest validation; a model becomes `ready` only after all expected files exist.
- [ ] Mark native Sherpa binaries and downloaded models unpacked in electron-builder; downloaded model weights must not inflate the installer.
- [ ] Run targeted tests and a real small interrupted/resumed download against an HTTP fixture.
- [ ] Commit with `feat(voice): manage local speech models`.

## Task 6: Implement Local and OpenAI-Compatible STT/TTS

**Files:**

- Create: `packages/desktop/src/process/services/fool-voice/audioCodec.ts`
- Create: `packages/desktop/src/process/services/fool-voice/SherpaVoiceProvider.ts`
- Create: `packages/desktop/src/process/services/fool-voice/OpenAICompatibleVoiceProvider.ts`
- Create: `packages/desktop/src/process/services/fool-voice/FoolVoiceService.ts`
- Modify: `packages/desktop/src/process/services/fool-voice/index.ts`
- Modify: `packages/desktop/src/process/bridge/foolVoiceBridge.ts`
- Modify: `packages/desktop/src/renderer/services/SpeechToTextService.ts`
- Create: `packages/desktop/src/renderer/services/voice/AudioPlaybackService.ts`
- Modify: `packages/desktop/src/renderer/hooks/system/useSpeechInput.ts`
- Test: `tests/unit/process/foolAudioCodec.test.ts`
- Test: `tests/unit/process/sherpaVoiceProvider.test.ts`
- Test: `tests/unit/process/openAICompatibleVoiceProvider.test.ts`
- Test: `tests/unit/renderer/audioPlaybackService.dom.test.ts`
- Test: `tests/integration/process/foolVoiceService.test.ts`

- [ ] Write failing PCM16 WAV decode/encode tests for valid mono 16 kHz, malformed headers, empty speech, and clipping.
- [ ] Write failing local-provider tests using an injected Sherpa adapter; verify Turkish language hint, Whisper int8 paths, Supertonic language `tr`, speaker ID, speed, and cancellation.
- [ ] Write failing OpenAI-compatible tests for `/audio/transcriptions`, `/audio/speech`, non-2xx redaction, timeout, abort, and binary response handling.
- [ ] Implement local STT/TTS behind lazy native imports so app startup and cloud-only use do not load Sherpa.
- [ ] Normalize local STT input to PCM16 WAV in the renderer, send it through the typed bridge, and preserve the existing OpenAI/Deepgram streaming behavior.
- [ ] Implement TTS output as WAV bytes and play it in an `HTMLAudioElement`; apply `setSinkId` where supported and surface an explicit degraded state where it is not.
- [ ] Verify local synthesis with the downloaded Turkish model and cloud behavior with a local OpenAI-compatible HTTP fixture.
- [ ] Run targeted tests, `bun run lint:fix`, `bun run format`, and `bunx tsc --noEmit`.
- [ ] Commit with `feat(voice): add local and compatible speech providers`.

## Task 7: Add VAD, Wake Phrase, Talk Mode, and Interruption

**Files:**

- Create: `packages/desktop/src/renderer/services/voice/voiceTurnMachine.ts`
- Create: `packages/desktop/src/renderer/services/voice/AdaptiveVad.ts`
- Create: `packages/desktop/src/renderer/services/voice/TranscriptWakeWordProvider.ts`
- Create: `packages/desktop/src/renderer/hooks/voice/useVoiceDevices.ts`
- Create: `packages/desktop/src/renderer/hooks/voice/useFoolVoiceSession.ts`
- Create: `packages/desktop/src/renderer/context/FoolVoiceContext.tsx`
- Modify: `packages/desktop/src/renderer/main.tsx`
- Modify: `packages/desktop/src/renderer/components/chat/SendBox/index.tsx`
- Test: `tests/unit/renderer/voiceTurnMachine.test.ts`
- Test: `tests/unit/renderer/adaptiveVad.test.ts`
- Test: `tests/unit/renderer/transcriptWakeWordProvider.test.ts`
- Test: `tests/integration/renderer/foolVoiceSession.dom.test.ts`

- [ ] Write failing state-machine tests for the approved lifecycle, cancellation from every active state, device loss, narrator failure fallback, and invalid transitions.
- [ ] Write failing adaptive-VAD tests for ambient calibration, minimum speech duration, configured silence timeout, maximum utterance, and quiet-room false starts.
- [ ] Implement `TranscriptWakeWordProvider` with the model ID `stt-phrase-v1`; normalize punctuation/case and match `hey fool`, `hey the fool`, and the configured phrase without accepting substring false positives.
- [ ] Implement hands-free looping: capture, VAD stop, transcribe, wake match, capture/send command, wait for turn completion, narrate, speak, then return to wake listening.
- [ ] Add barge-in so detected speech immediately aborts `AudioPlaybackService` before opening the next capture.
- [ ] Add microphone/speaker device switching that cancels active resources and explicitly reinitializes the selected device.
- [ ] Add a typed `fool:voice-submit` event consumed by the currently mounted generic `SendBox`, preserving all ACP/Aionrs routing and permission behavior.
- [ ] Run targeted tests with fake media devices and clocks, then perform a manual quiet-room Turkish wake/VAD test.
- [ ] Commit with `feat(voice): add hands-free Fool conversation`.

## Task 8: Build the Voice Surface and Complete Internationalization

**Files:**

- Create: `packages/desktop/src/renderer/components/voice/FoolVoiceOrb.tsx`
- Create: `packages/desktop/src/renderer/components/voice/FoolVoiceOrb.module.css`
- Create: `packages/desktop/src/renderer/components/voice/VoiceStatusPanel.tsx`
- Create: `packages/desktop/src/renderer/components/settings/SettingsModal/contents/voice/VoiceSettingsContent.tsx`
- Create: `packages/desktop/src/renderer/components/settings/SettingsModal/contents/voice/ProviderCard.tsx`
- Create: `packages/desktop/src/renderer/components/settings/SettingsModal/contents/voice/ModelManager.tsx`
- Create: `packages/desktop/src/renderer/components/settings/SettingsModal/contents/voice/DeviceSelector.tsx`
- Modify: `packages/desktop/src/renderer/components/settings/SettingsModal/index.tsx`
- Modify: `packages/desktop/src/renderer/components/layout/Layout.tsx`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/settings.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/conversation.json`
- Generate: `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts`
- Test: `tests/unit/renderer/foolVoiceOrb.dom.test.tsx`
- Test: `tests/unit/renderer/voiceSettingsContent.dom.test.tsx`

- [ ] Write failing component tests for every real state: idle, wake listening, command listening, transcribing, agent running, narrating, speaking, muted, degraded, and error.
- [ ] Build a compact mask orb whose motion reflects real state and stops while idle; add accessible text, mute, push-to-talk, Talk mode, and stop controls.
- [ ] Build a dedicated Voice settings tab with device selectors, input meter, local/cloud labels, provider health, model download/remove/progress, STT test, TTS preview, VAD timeout, wake sensitivity, voice/speaker, speed, volume, narrator, and per-agent override controls.
- [ ] Hide voice-profile/cloning controls because the two default providers do not advertise `voice-cloning`.
- [ ] Add keys to all thirteen configured locale directories, using reviewed Turkish and English copy and accurate fallback translations for the remaining locales.
- [ ] Run `bun run i18n:types`, `node scripts/check-i18n.js`, component tests, `bun run lint:fix`, `bun run format`, and `bunx tsc --noEmit`.
- [ ] Commit with `feat(voice): add The Fool voice controls`.

## Task 9: Produce Truthful Natural Spoken Briefs

**Files:**

- Create: `packages/desktop/src/renderer/services/voice/narrationSanitizer.ts`
- Create: `packages/desktop/src/renderer/services/voice/RunEvidenceCollector.ts`
- Create: `packages/desktop/src/renderer/services/voice/FoolNarrator.ts`
- Modify: `packages/desktop/src/renderer/context/FoolVoiceContext.tsx`
- Test: `tests/unit/renderer/narrationSanitizer.test.ts`
- Test: `tests/unit/renderer/runEvidenceCollector.test.ts`
- Test: `tests/unit/renderer/foolNarrator.test.ts`
- Test: `tests/integration/renderer/voiceNarrationFlow.dom.test.ts`

- [ ] Write hostile-input tests proving speech removes fenced/inline code, raw diffs, tables, Markdown syntax, long URLs/hashes, terminal noise, repeated telemetry, and secret-like values.
- [ ] Write evidence tests for completed/failed tools, changed file names without diff bodies, explicit test outcomes, unresolved errors, required decisions, and interrupted playback.
- [ ] Subscribe once to `conversation.responseStream` and `conversation.turnCompleted`, group evidence by conversation/turn ID, and dispose completed/expired runs.
- [ ] Implement a deterministic Turkish/English brief that never upgrades unknown test status to passed and remains under the configured spoken length.
- [ ] Implement an optional OpenAI-compatible narrator using only structured evidence; validate returned JSON and fall back deterministically on timeout, invalid output, or unsupported language.
- [ ] Keep displayed assistant content untouched while passing only `NarrationOutput.spokenText` to TTS.
- [ ] Run narration unit/integration tests, then manually verify a representative code response speaks no code or raw log.
- [ ] Commit with `feat(voice): narrate verified agent outcomes`.

## Task 10: Add Agent-Independent Fool Memory

**Files:**

- Create: `packages/desktop/src/common/types/foolMemory.ts`
- Create: `packages/desktop/src/process/services/fool-memory/FoolMemoryRepository.ts`
- Create: `packages/desktop/src/process/services/fool-memory/FoolMemoryService.ts`
- Create: `packages/desktop/src/process/services/fool-memory/index.ts`
- Create: `packages/desktop/src/process/bridge/foolMemoryBridge.ts`
- Modify: `packages/desktop/src/process/bridge/index.ts`
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts`
- Create: `packages/desktop/src/renderer/services/memory/memoryPrompt.ts`
- Create: `packages/desktop/src/renderer/components/settings/SettingsModal/contents/memory/MemorySettingsContent.tsx`
- Modify: `packages/desktop/src/renderer/components/settings/SettingsModal/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx`
- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/settings.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/conversation.json`
- Test: `tests/unit/process/foolMemoryRepository.test.ts`
- Test: `tests/unit/process/foolMemoryService.test.ts`
- Test: `tests/unit/renderer/memoryPrompt.test.ts`
- Test: `tests/unit/renderer/memorySettingsContent.dom.test.tsx`
- Test: `tests/integration/renderer/memoryInjection.test.ts`

- [ ] Write failing repository tests for typed records, provenance, enabled state, project/global scope, edit/delete, and database reopening.
- [ ] Store memory in `<userData>/fool/fool-memory.sqlite` so it is local, agent-independent, and isolated from AionCore schema migrations.
- [ ] Write failing relevance tests for token overlap, recency tie-breaking, disabled/deleted exclusion, project scoping, duplicate suppression, and a strict context size limit.
- [ ] Implement explicit candidate approval; no run or correction may write memory without a user confirmation.
- [ ] Add a Memory settings tab to view, add, edit, enable/disable, scope, and delete preferences, corrections, project facts, procedures, and failure lessons.
- [ ] Add relevant enabled memories to outbound ACP/Aionrs prompts inside a bounded `<!-- THE_FOOL_MEMORY ... -->` context envelope while leaving the user's visible message unchanged.
- [ ] Add candidate creation from explicit "remember/hatırla" commands and narrator-detected corrections; show source and exact proposed text before approval.
- [ ] Run memory tests, i18n generation/checks, formatting, lint, and type checking.
- [ ] Commit with `feat(memory): add inspectable shared Fool Memory`.

## Task 11: Rebrand and Verify Authenticated LAN Phone Control

**Files:**

- Modify: `packages/desktop/src/process/utils/webuiConfig.ts`
- Modify: `packages/desktop/src/process/bridge/webuiBridge.ts`
- Modify: `packages/desktop/src/renderer/components/settings/SettingsModal/contents/WebuiModalContent.tsx`
- Modify: `packages/desktop/src/renderer/components/layout/Titlebar/MobileConversationBrand.tsx`
- Modify: `packages/desktop/src/renderer/components/chat/MobileActionSheet/MobileActionSheet.tsx`
- Modify: `packages/desktop/src/renderer/components/chat/MobileActionSheet/types.ts`
- Create: `packages/desktop/src/renderer/components/chat/MobileActionSheet/useVoiceEntry.tsx`
- Modify: `packages/web-host/src/static-server.ts`
- Modify: `packages/web-host/src/types.ts`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/settings.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/conversation.json`
- Test: `tests/unit/process/webuiConfig.test.ts`
- Test: `tests/integration/web-host-auth.test.ts`
- Test: `tests/e2e/cases/webui/the-fool-mobile-control.e2e.ts`

- [ ] Write failing tests for local-only default, explicit LAN binding, authentication before app/API access, expiring QR tokens, and no public-interface auto-selection.
- [ ] Preserve compatibility config keys but show The Fool Remote in UI, logs, QR instructions, browser/PWA title, and mobile brand.
- [ ] Require the user to opt into the detected LAN interface; retain username/password authentication and the existing expiring QR login token.
- [ ] Add a mobile voice-message action using the browser file/capture path when insecure LAN HTTP blocks `getUserMedia`; label that local-Sherpa phone transcription requires the desktop bridge and otherwise uses the configured HTTP STT provider.
- [ ] Verify mobile agent selection, text send, run status, permission approve/deny, and final result at 390 x 844.
- [ ] Run WebUI unit/integration/E2E tests, i18n checks, lint, format, and type checking.
- [ ] Commit with `feat(webui): add The Fool LAN phone control`.

## Task 12: Verify OpenClaw, Hermes, and Agent Switching

**Files:**

- Create: `scripts/verify-fool-agents.ts`
- Create: `docs/testing/the-fool-agent-matrix.md`
- Modify: `packages/desktop/src/renderer/components/settings/SettingsModal/contents/AgentModalContent.tsx`
- Test: `tests/integration/agents/foolAgentDetection.test.ts`
- Test: `tests/e2e/cases/agents/fool-agent-switching.e2e.ts`

- [ ] Write a failing detection test for the installed OpenClaw command and Hermes ACP command without importing either agent's speech configuration.
- [ ] Add a read-only agent readiness section showing detected command, version, ACP/gateway health, and a real connection-test result.
- [ ] Implement `scripts/verify-fool-agents.ts` to test detection and connection without changing agent settings or granting permissions.
- [ ] Complete one harmless real turn with OpenClaw and one with Hermes in a temporary workspace; record command/version, elapsed time, result, and cleanup in the matrix.
- [ ] Switch agents while Fool Voice settings remain byte-for-byte unchanged and verify permission requests are still visible.
- [ ] Run agent integration/E2E tests and commit with `test(agents): verify The Fool ACP targets`.

## Task 13: Spike Voice Cloning Honestly

**Files:**

- Create: `docs/research/the-fool-voice-cloning-spike.md`
- Modify only if all gates pass: `packages/desktop/src/common/types/foolVoice.ts`
- Modify only if all gates pass: `packages/desktop/src/process/services/fool-voice/SherpaVoiceProvider.ts`
- Modify only if all gates pass: `packages/desktop/src/renderer/components/settings/SettingsModal/contents/voice/VoiceSettingsContent.tsx`
- Test only if enabled: `tests/integration/process/foolVoiceCloning.test.ts`

- [ ] Evaluate Sherpa PocketTTS/ZipVoice model and code licenses, Windows x64 runtime health, Turkish intelligibility, cold/warm latency, reference-sample deletion, and explicit authorization wording.
- [ ] Record source URLs, licenses, model size, measured latency, failure modes, and a pass/fail decision.
- [ ] If every gate passes, add `voice-cloning` capability, a mandatory authorization checkbox, sample preview, profile rename/delete, and integration tests.
- [ ] If any gate fails, keep cloning controls absent and document the exact reason; do not ship a placeholder workflow.
- [ ] Commit with `docs(voice): record cloning capability decision` or `feat(voice): add authorized local voice profiles`.

## Task 14: Complete Full Verification and Build the Windows Alpha

**Files:**

- Create: `docs/testing/the-fool-alpha-acceptance.md`
- Create: `docs/ALPHA_LIMITATIONS.md`
- Modify: `README.md`
- Verify: `release/*`

- [ ] Run `bun run test` and `bun run test:coverage`; require at least 80% coverage for new source files.
- [ ] Run `bun run i18n:types` followed by `node scripts/check-i18n.js`.
- [ ] Run `bun run lint:fix`, `bun run format`, `bun run format:check`, and `bunx tsc --noEmit`.
- [ ] Run focused Playwright suites for branding, voice settings, memory, agents, and mobile WebUI.
- [ ] Execute the sixteen approved manual acceptance flows on Windows, including Turkish wake/VAD, local STT/TTS, spoken code-task brief, barge-in, OpenClaw, Hermes, memory approval/deletion, and phone permission resolution.
- [ ] Run `bun run build-win:x64` and install the generated NSIS artifact in a clean local test profile.
- [ ] Verify installer, executable, taskbar, tray, window, About, WebUI, and PWA all present The Fool identity and legible icons.
- [ ] Record artifact path, SHA-256, size, test evidence, optional capability decisions, and honest limitations in the acceptance document.
- [ ] Update `README.md` with install, local model download, cloud provider, Talk mode, wake phrase, memory, phone access, and troubleshooting instructions.
- [ ] Commit with `chore(release): prepare The Fool Windows alpha`.

## Final Review Gate

- [ ] Inspect `git diff --check`, `git status --short`, and the complete commit list; confirm no changes exist in `C:\Fool`.
- [ ] Search primary product surfaces for `AionUi|AionUI` and classify every remaining result as internal compatibility, license attribution, or a defect to fix.
- [ ] Search new source and docs for `TODO|FIXME|placeholder|coming soon|fake|mock` and remove any product-facing non-functional behavior.
- [ ] Confirm all bridge request/response types match their service implementations and no `any` was introduced.
- [ ] Confirm every cloud action is labeled before use and no logs contain secrets or raw microphone audio.
- [ ] Do not claim completion until the installer and all applicable checks have fresh passing evidence.
