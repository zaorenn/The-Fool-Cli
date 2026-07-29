# The Fool — Local Model Discovery and Built-in Voice Design

**Date:** 2026-07-29
**Status:** Approved by user; implementation plan pending
**Base spec:** `docs/specs/2026-07-29-the-fool-windows-alpha-design.md`
**Base plan:** `docs/specs/2026-07-29-the-fool-windows-alpha-implementation-plan.md`
**Branch:** `feat/the-fool-windows-alpha`

## 1. Purpose

This is a **delta specification**. It amends the approved The Fool Windows Alpha design in three
areas and records two new project-wide constraints. Everything in the base spec that this document
does not explicitly change remains in force.

The three changes are:

- **A.** The model picker must list every model installed in LM Studio, not only the models LM
  Studio currently has loaded.
- **B.** A hands-free conversation control must be present and always visible in the message
  composer, including on the welcome screen.
- **C.** Speech-to-text, text-to-speech, and voice cloning must be built-in capabilities of The Fool,
  configured from a dedicated Voice category in Settings, independent of the selected agent.

## 2. New project-wide constraints

### 2.1 Zero regression against upstream AionUi

No user-facing capability that exists in upstream AionUi may be missing, hidden, or broken in The
Fool. Rebranding, theming, and additive features must not remove functionality.

This is verified, not assumed. Verification method:

1. Enumerate upstream user-facing surfaces from `origin/main`: settings categories and their
   controls, conversation platform types, chat composer actions, slash commands, file and media
   handling, WebUI routes, and tray/menu actions.
2. Record the enumeration in `docs/testing/the-fool-upstream-parity.md` as a checklist.
3. For every item, record: present / renamed / intentionally changed with reason. "Missing" is a
   defect and blocks completion.

Intentional divergences already approved in the base spec (default theme, product identity,
disabled upstream auto-update for this private alpha) are recorded as intentional, with the reason,
rather than treated as regressions.

### 2.2 Packaging deferred

Windows `.exe` and NSIS installer production is **out of scope for this delta**. The base plan's
Task 14 remains the packaging step and will be requested separately by the user once the behavior in
this document is confirmed working. Nothing in this delta may break the existing build, and
`bun run package` must continue to succeed.

## 3. Change A — Complete LM Studio model discovery

### 3.1 Problem

The model list for a provider is produced by the AionCore backend through
`POST /api/providers/:id/models`. For an OpenAI-compatible provider the backend queries the
provider's `/v1/models`. LM Studio's `/v1/models` returns only **loaded** models.

Measured on the target machine: 16 models are installed (110 GB on disk); `/v1/models` and
`/api/v0/models` each returned 2. `lms ls --json` returned all 16.

The AionCore backend is a separate binary and is not modifiable from this repository.

### 3.2 Seam

`IProvider.models: string[]` is persisted server-side and is writable from the desktop process via
`PUT /api/providers/:id` (`ipcBridge.mode.updateProvider`). Writing the complete list into that
field makes every downstream consumer — the chat model picker, model settings, scheduled tasks —
show the full list with no backend change.

### 3.3 Design

A new main-process service directory `packages/desktop/src/process/services/local-models/` holds:

- `LmStudioModelSource.ts` — resolves the complete installed-model list
- `lmsCli.ts` — locates and invokes the `lms` CLI
- `modelDirScan.ts` — filesystem fallback
- `LocalProviderRegistrar.ts` — provider registration and model-list publication
- `index.ts` — public exports

The existing untracked `packages/desktop/src/process/utils/localProviderDiscovery.ts` is moved into
this directory as `LocalProviderRegistrar.ts`, gains tests, and its importer
`runBackendMigrations.ts` is updated.

`LmStudioModelSource` resolves the list through three tiers and reports which tier produced the
result:

**Tier 1 — `lms` CLI (preferred).** Locate the executable at `%USERPROFILE%\.lmstudio\bin\lms.exe`,
then fall back to `lms` on `PATH`. Run `lms ls --json` with a 5-second timeout. Parse defensively:
each entry contributes a model only when `modelKey` is a non-empty string. Known fields consumed are
`modelKey`, `type`, `displayName`, `maxContextLength`, and `trainedForToolUse`; unknown fields are
ignored. Entries whose `type` is `embedding` are excluded. Tier result: `complete`.

**Tier 2 — model directory scan.** Used when the CLI is absent, times out, exits non-zero, or emits
unparseable output. The models directory is user-relocatable in LM Studio, so it is read from LM
Studio's own configuration under `%USERPROFILE%\.lmstudio\.internal\`, falling back to
`%USERPROFILE%\.lmstudio\models` only when no configured path is readable. The scan walks at most
three levels, collects `*.gguf` files, and excludes files whose basename starts with `mmproj-`
(vision projectors are not standalone models). The identifier is the path-relative
`<publisher>/<repo>/<file>.gguf` form. Observation supporting this: `lms ls --json` reports exactly
this string as each entry's `indexedModelIdentifier`. That LM Studio accepts it in a completion
request's `model` field is **assumed, not yet verified**, and must be proven before tier 2 ships; if
it is rejected, tier 2 is limited to detecting installed models and the request identifier is
resolved through tier 1 or 3. The scan is bounded to 2000 files. Tier result: `complete-degraded` —
complete set, coarser metadata.

**Tier 3 — HTTP.** Used when tiers 1 and 2 both fail. Query `/api/v0/models`, then `/v1/models`.
Tier result: `loaded-only`. The UI labels this list as incomplete and names the reason. It is never
presented as the full set.

The resolved identifiers are merged as a union with the list the AionCore backend already returned,
then deduplicated and sorted stably, so a currently loaded model can never disappear from the
picker. The merged list is written with `PUT /api/providers/:id`.

**Provider matching.** A provider is treated as LM Studio when its `base_url` host is a loopback
address and its port matches LM Studio's configured server port (read from
`.internal/http-server-config.json`, default `1234`). Platform and display name are not used as the
sole signal, because the provider is registered with `platform: 'openai'`.

**Refresh triggers.** Application start, after the backend is reachable; and immediately after the
user activates the existing "fetch models" action in Model settings for a matched provider.

### 3.4 Model activation

No activation code is written. LM Studio loads a requested model just-in-time when a chat completion
names it. The Fool passes the selected model identifier through unchanged.

Verification requirement: confirm just-in-time loading is enabled on the target machine. If a send
fails because the model is not loaded, LM Studio's own error text is surfaced in the conversation
without being rewritten or masked. The Fool does not implement its own load, unload, VRAM, or
confirmation policy.

### 3.5 Ollama

Ollama's `/api/tags` already returns every pulled model rather than only running ones. No change is
made to Ollama discovery.

### 3.6 Honest limitation

`lms ls --json` is a CLI output format, not a documented stable contract. Tiers 2 and 3 exist
specifically so that a format change degrades the result instead of emptying the model list.

## 4. Change B — Always-available hands-free conversation control

### 4.1 Current state

`packages/desktop/src/renderer/components/chat/VoiceTalkButton.tsx` is an uncommitted stub whose
click handler writes to the console. `SpeechInputButton` renders `null` unless the optional
`tools.speechToText.enabled` setting is true, which is why no microphone appears on the welcome
screen.

### 4.2 Design

A single control in the composer starts and stops a hands-free session. The loop is:

```text
listen -> silence ends the utterance -> transcribe -> submit through the existing SendBox
       -> agent runs -> narrate -> speak -> listen
```

User speech during playback aborts playback immediately and opens the next turn.

This behavior is implemented by the base plan's Task 7 components (`voiceTurnMachine`, `AdaptiveVad`,
`TranscriptWakeWordProvider`, `useFoolVoiceSession`, `FoolVoiceContext`), which are not yet written.
This delta therefore **includes completing base-plan Task 7**; it does not replace it. Submission
continues to flow through the generic `SendBox`, preserving all existing ACP and Aionrs routing and
permission behavior.

### 4.3 Visibility rule

The control is always visible, because voice is a built-in capability of The Fool rather than an
optional tool. It is never a dead control: when required speech models are not installed, activating
it opens the Voice settings installation flow and states plainly which model is missing. The
`tools.speechToText.enabled` gate governs the separate one-shot dictation button only and is not
applied to this control.

The welcome screen (`GuidPage`) renders the same `SendBox`, so the control appears there as well.

### 4.4 Out of scope

A separate full-screen conversation overlay is explicitly deferred at the user's request.

## 5. Change C — Built-in voice with a dedicated Settings category

### 5.1 Settings category

A new top-level **Voice** category is added to the Settings sidebar, backed by
`packages/desktop/src/renderer/components/settings/SettingsModal/contents/voice/`. Voice controls
move out of `SystemModalContent`. Sections:

1. **Devices** — microphone and speaker selection, live input level, microphone test.
2. **Conversation** — wake phrase, silence timeout that ends an utterance, barge-in toggle.
3. **Speech to text** — provider (local or OpenAI-compatible), model install/remove with measured
   progress, health, sample transcription test.
4. **Text to speech** — provider, model, voice, speed, volume, preview.
5. **Voice cloning** — conditional; see 5.4.

Local and cloud paths are labeled before any data leaves the machine, per base spec principle 3.

### 5.2 Model catalog additions

`VoiceModelCatalog` gains two managed entries alongside the existing Whisper Tiny and Supertonic 3:

- **Kokoro** — natural English TTS, Apache-2.0, becomes the default TTS model.
- **ZipVoice** — zero-shot voice cloning from a reference recording.

Both are already compiled into the pinned `sherpa-onnx-node@1.13.4` binding (verified: `Kokoro` and
`Zipvoice` appear in the binding's TTS model config types). No new runtime dependency is added.

Each new entry follows the existing catalog contract: an official `k2-fsa/sherpa-onnx` release URL,
a pinned `sha256`, an expected-file manifest, and `ready` status only after every expected file
exists. Exact URLs, checksums, and archive sizes are resolved and recorded during implementation;
no entry ships with an unverified checksum.

### 5.3 Language policy

Speech output defaults to natural English via Kokoro. When a reply is Turkish, synthesis falls back
to the existing Supertonic Turkish model. Speech input is unchanged: multilingual Whisper handles
both languages. Turkish remains fully usable; English is the default voice.

### 5.4 Voice cloning

Cloning is local-only. No reference audio and no generated profile leaves the machine. Cloud cloning
is out of scope by user decision.

Settings flow: record a reference sample (roughly 10–20 seconds) or import an audio file, confirm an
explicit authorization statement that the voice is the user's own or is used with permission, create
a named profile, preview it, rename it, delete it. Deleting a profile deletes its stored reference
audio.

**Gate.** The cloning section ships only if ZipVoice passes a measured spike on the target machine:
Windows x64 operation through `sherpa-onnx-node`, acceptable English intelligibility, usable
latency, licensing that permits redistribution in this application, and verified deletion of
reference samples. If any gate fails, the cloning section is not rendered at all, the reason is
recorded in `docs/research/`, and Kokoro's preset voices remain the available choice. No placeholder
or non-functional cloning UI ships.

This supersedes the base plan's Task 8 instruction to hide cloning controls unconditionally, and
pulls the base plan's Task 13 spike forward to gate this section.

Cloning quality is expected to be good in English and poor in Turkish, because ZipVoice is trained
on English and Chinese. This is stated in the UI rather than discovered by the user.

### 5.5 Internationalization

Every new user-facing string uses i18n keys added to all locale directories listed in
`packages/desktop/src/common/config/i18n-config.json`, with reviewed English and Turkish copy.
`bun run i18n:types` and `node scripts/check-i18n.js` must pass.

## 6. Error handling

- Model discovery reports its tier. A degraded or loaded-only list is labeled with the reason and is
  never presented as complete.
- A discovery failure leaves the previously known model list intact rather than clearing it.
- LM Studio load failures surface LM Studio's own message unmodified.
- Every voice stage keeps the base spec's typed unavailable, degraded, busy, cancelled, and failed
  states.
- A missing speech model produces an actionable install prompt, never a silent no-op.
- Cloning failures name the failing stage and do not leave orphaned reference audio.
- Logs record timings, tiers, and state transitions — never microphone audio, reference samples,
  API keys, or model file contents.

## 7. Testing

Each behavior change begins with a focused failing test, and each `describe` includes at least one
failure path, per the base plan's global constraints.

- `lmsCli`: valid JSON, malformed JSON, non-zero exit, timeout, missing executable, embedding-type
  exclusion.
- `modelDirScan`: nested layout discovery, `mmproj-` exclusion, relocated directory, unreadable
  directory, file-count bound.
- `LmStudioModelSource`: tier selection and reported tier for each failure combination, union merge
  preserving backend-returned models, stable ordering, deduplication.
- `LocalProviderRegistrar`: provider matched by loopback host and configured port, no duplicate
  provider creation, publication failure leaves the existing list unchanged.
- Voice settings components: every real state rendered, including missing-model and degraded states.
- Talk control: hidden-state absence of dead-click behavior, install prompt when models are missing,
  barge-in aborting playback.

Coverage for new source files meets the project's 80% target.

## 8. Acceptance

1. With 16 models installed in LM Studio and 2 loaded, the chat model picker lists all 16.
2. Renaming or relocating the LM Studio models directory does not empty the list.
3. With the `lms` CLI unavailable, the list is still complete and is labeled as directory-derived.
4. With LM Studio stopped, the previously known model list is retained rather than cleared.
5. Selecting an unloaded model and sending a message produces a real reply, with LM Studio
   performing the load; a load failure shows LM Studio's own error text.
6. The conversation control is visible in the composer on both the welcome screen and an open
   conversation.
7. With no speech models installed, activating the control opens the installation flow and names the
   missing model.
8. With models installed, a spoken English request is transcribed, routed to the selected agent,
   answered, and spoken back; speaking during playback stops it and starts a new turn.
9. Settings shows a dedicated Voice category containing all five sections.
10. Kokoro English synthesis is intelligible and natural; a Turkish reply is spoken in Turkish.
11. Voice cloning either works end-to-end from Settings — record, authorize, preview, delete — or is
    absent with a recorded reason. No placeholder is present.
12. The upstream parity checklist in `docs/testing/the-fool-upstream-parity.md` records no missing
    capability.
13. `bun run test`, `bunx tsc --noEmit`, `bun run lint:fix`, `bun run format:check`,
    `bun run i18n:types`, `node scripts/check-i18n.js`, and `bun run package` all pass.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| `lms ls --json` output format changes | Three-tier resolution; format change degrades rather than empties |
| ZipVoice unproven on Windows x64 through this binding | Measured gate; cloning section omitted with a recorded reason if it fails |
| Kokoro covers English and Chinese, not Turkish | Supertonic Turkish retained as the Turkish voice |
| Moving voice settings out of `SystemModalContent` could hide an existing control | Covered by the zero-regression parity checklist |
| Scope creep from "nothing may be missing" | Parity checklist is a verification artifact, not a mandate to add new upstream features |

## 10. Explicitly out of scope

- Permission-mode changes. Agent-advertised modes (`Off`/`Minimal`/`Low`/`Medium`/`High`) are owned
  by the agent over ACP. They are not renamed, remapped, or wrapped. User decision.
- A full-screen conversation overlay. Deferred by the user to a later change.
- Cloud voice cloning.
- Any model load, unload, VRAM, or confirmation policy. LM Studio owns this.
- Windows `.exe` and installer production. Deferred per section 2.2.
