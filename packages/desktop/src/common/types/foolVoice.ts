/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { DEFAULT_ORB_SKIN } from '@/common/config/configKeys';
import { DEFAULT_TRANSCRIPT_RULES, type TranscriptRules } from '@/common/voice/transcriptRules';

export type VoiceProviderId = 'local-sherpa' | 'local-audiocpp' | 'openai-compatible' | 'transcript-wake-word';
export type VoiceProviderKind = 'local' | 'remote' | 'derived';

/** Providers that install and run their models on this machine. */
export type LocalVoiceProviderId = 'local-sherpa' | 'local-audiocpp';

/**
 * Which processor the local speech engine runs on.
 *
 * Not a performance preference so much as a different build: upstream ships a
 * CPU-only package and a CUDA package, and the CUDA one is roughly eighty times
 * the download because it carries the CUDA runtime beside it. Choosing `cuda`
 * is therefore a decision to fetch that, which is why it is a setting rather
 * than something detected and switched silently.
 */
export type VoiceEngineBackend = 'cpu' | 'cuda';

/** Providers a synthesis request may name. */
export type SynthesisProviderId = LocalVoiceProviderId | 'openai-compatible';
export type VoiceCapability =
  | 'transcribe'
  | 'synthesize'
  | 'wake-word'
  | 'manage-models'
  | 'stream-transcription'
  | 'stream-synthesis'
  | 'voice-cloning';

export type VoiceProvider = {
  id: VoiceProviderId;
  kind: VoiceProviderKind;
  displayName: string;
  privacy: 'local' | 'network' | 'inherits-stt';
  capabilities: readonly VoiceCapability[];
};

export const FOOL_VOICE_PROVIDERS = [
  {
    id: 'local-sherpa',
    kind: 'local',
    displayName: 'Local Sherpa',
    privacy: 'local',
    capabilities: ['transcribe', 'synthesize', 'manage-models'],
  },
  {
    id: 'local-audiocpp',
    kind: 'local',
    displayName: 'Local audio.cpp',
    privacy: 'local',
    // No `transcribe`: the engine exposes an ASR route, but this integration
    // only ever speaks. Transcription stays with sherpa, which is already
    // installed and measured.
    capabilities: ['synthesize', 'manage-models', 'voice-cloning'],
  },
  {
    id: 'openai-compatible',
    kind: 'remote',
    displayName: 'OpenAI Compatible',
    privacy: 'network',
    capabilities: ['transcribe', 'synthesize'],
  },
  {
    id: 'transcript-wake-word',
    kind: 'derived',
    displayName: 'Transcript Wake Word',
    privacy: 'inherits-stt',
    capabilities: ['wake-word'],
  },
] as const satisfies readonly VoiceProvider[];

export type VoiceModelState =
  | { status: 'unmanaged' }
  | { status: 'not-installed' }
  | { status: 'partial'; downloadedBytes: number }
  | { status: 'installing'; operationId: string }
  | { status: 'ready' }
  | {
      status: 'invalid';
      /**
       * `no-engine` — the weights are here and nothing installed can load them.
       *
       * Its own reason because it is the only one a download cannot fix, and
       * because it used to report `ready`: a row whose engine the synthesiser
       * has no loader for was offered, installed, selected, and then produced
       * silence, with the failure swallowed inside playback.
       */
      reason: 'archive-invalid' | 'manifest-mismatch' | 'missing-files' | 'no-engine';
    };

type VoiceModelBase = {
  id: string;
  providerId: VoiceProviderId;
  displayName: string;
  languages: readonly string[];
};

type ManagedVoiceModel = VoiceModelBase & {
  distribution: 'managed';
  state: Exclude<VoiceModelState, { status: 'unmanaged' }>;
  downloadBytes: number | null;
  installedBytes: number | null;
};

type UnmanagedVoiceModel = VoiceModelBase & {
  distribution: 'remote' | 'built-in';
  state: { status: 'unmanaged' };
};

type VoiceModelRole =
  | {
      role: 'speech-to-text';
      audioInput: {
        container: 'wav';
        encoding: 'pcm16le';
        sampleRateHz: 16000;
        channels: 1;
      };
    }
  | {
      role: 'text-to-speech';
      audioOutput: { container: 'wav'; encoding: 'pcm16le'; channels: 1 };
      profileIds: readonly string[];
      /**
       * True when the engine has no voice of its own and cannot say anything
       * until the user clones one.
       *
       * Distinct from an empty `profileIds`, which only means "no presets are
       * listed". Installing one of these leaves a working engine that is mute,
       * and the picker says so rather than letting the user find out by pressing
       * Preview.
       */
      requiresClonedVoice?: true;
      /**
       * Generation knobs this model accepts, from the engine's own schema.
       *
       * Absent for engines that expose none — sherpa's synthesis call takes
       * `{ text, sid, speed }` and has nothing else to offer.
       */
      paramSpecs?: readonly VoiceParamSpec[];
    }
  | {
      role: 'wake-word';
      phraseModel: true;
    };

export type VoiceModel = (ManagedVoiceModel | UnmanagedVoiceModel) & VoiceModelRole;

export type VoiceProfile =
  | {
      id: string;
      providerId: VoiceProviderId;
      modelId: string;
      kind: 'preset';
      state: 'unavailable' | 'ready';
      displayName: string;
      languages: readonly string[];
      speakerId: number;
      deletable: false;
    }
  | {
      id: string;
      providerId: VoiceProviderId;
      modelId: string;
      kind: 'cloned';
      state: 'creating' | 'ready' | 'failed';
      displayName: string;
      languages: readonly string[];
      deletable: true;
    };

export type VoiceHealthReason =
  | 'service-not-registered'
  | 'unsupported-platform'
  | 'model-not-installed'
  | 'model-invalid'
  | 'credential-missing'
  | 'endpoint-unreachable'
  | 'device-unavailable'
  | 'provider-failed';

type VoiceHealthBase = {
  providerId: VoiceProviderId;
  capability?: VoiceCapability;
  modelId?: string;
};

export type VoiceHealth =
  | (VoiceHealthBase & { status: 'checking'; startedAtMs: number })
  | (VoiceHealthBase & {
      status: 'unavailable';
      checkedAtMs: number;
      reason: VoiceHealthReason;
      action: 'download-model' | 'configure-provider' | 'select-device' | 'retry' | 'none';
    })
  | (VoiceHealthBase & {
      status: 'ready';
      checkedAtMs: number;
      latencyMs?: number;
    })
  | (VoiceHealthBase & {
      status: 'degraded' | 'failed';
      checkedAtMs: number;
      reason: VoiceHealthReason;
      action: 'download-model' | 'configure-provider' | 'select-device' | 'retry' | 'none';
      safeMessage?: string;
    });

type VoiceDownloadProgressBase = {
  operationId: string;
  providerId: LocalVoiceProviderId;
  modelId: string;
  sequence: number;
  attempt: number;
  downloadedBytes: number;
  totalBytes: number | null;
  updatedAtMs: number;
};

export type VoiceDownloadProgress =
  | (VoiceDownloadProgressBase & {
      state: 'queued' | 'downloading' | 'extracting' | 'validating';
    })
  | (VoiceDownloadProgressBase & { state: 'ready' | 'cancelled' })
  | (VoiceDownloadProgressBase & {
      state: 'failed';
      errorCode: 'network' | 'http-status' | 'archive-invalid' | 'manifest-mismatch' | 'security-rejected' | 'io';
    });

/** One generation parameter's value, as the engine's schema declares it. */
export type VoiceParamValue = number | boolean | string;

/** A model's generation parameters, keyed by the engine's own parameter name. */
export type VoiceParams = Record<string, VoiceParamValue>;

/**
 * One knob an engine exposes, declared once and read everywhere.
 *
 * The declarations themselves live with the engine that owns them
 * (`process/services/fool-voice/audiocpp/audioCppEngineSpecs.ts`) and reach the
 * renderer on the model's catalog entry. Only the shape is shared, because the
 * renderer may not import from the main process — so this is a type, and the
 * catalog is the wire.
 */
export type VoiceParamSpec =
  | {
      name: string;
      type: 'number';
      min: number;
      max: number;
      /** UI granularity. Integer parameters use 1. */
      step: number;
      /** Rejected when not a whole number. */
      integer?: boolean;
      default: number;
    }
  | { name: string; type: 'boolean'; default: boolean }
  | { name: string; type: 'text'; maxLength: number; default: string };

export type FoolVoiceAgentOverride = {
  narrationEnabled?: boolean;
  tts?: {
    providerId?: SynthesisProviderId;
    modelId?: string;
    profileId?: string;
    language?: string;
    speed?: number;
  };
  narrator?: {
    language?: 'tr' | 'en';
    maxSpokenCharacters?: number;
  };
};

export type FoolVoiceSettings = {
  schemaVersion: number;
  enabled: boolean;
  devices: {
    inputDeviceId: string | null;
    outputDeviceId: string | null;
  };
  activation: {
    talkModeEnabled: boolean;
    /**
     * A desktop-wide shortcut that starts a spoken turn with no window focused.
     *
     * Empty means none. Electron's accelerator syntax, e.g. `Control+Alt+V`.
     */
    pushToTalkShortcut: string;
    /**
     * In a conversation, hold right Ctrl to speak instead of always listening.
     *
     * Always-on listening only works if silence is heard as silence, and it is
     * not: the transcriber answers a keystroke or a fan with a confident
     * sentence, so an empty room produced a stream of questions nobody asked.
     * Filtering the invented ones helps and cannot be complete — the model can
     * always invent a sentence that is not on any list.
     *
     * Holding a key is the only version of this with no false positives at all,
     * because the microphone is shut. Off by default: speaking without touching
     * anything is the reason to have a spoken assistant, and this trades it away
     * for certainty.
     */
    conversationHoldToTalk: boolean;
    /**
     * Whether the assistant may say anything nobody asked for.
     *
     * A finished task volunteering itself, a question about the person — all of
     * it, one switch. On by default, because an assistant that only ever
     * answers is a command line with a microphone, and this is the whole
     * difference between the two.
     *
     * It exists at all because proactive speech that cannot be turned off is
     * the reason proactive assistants get uninstalled rather than configured.
     * Saying "be quiet" hushes it for the session; this is the answer for
     * somebody who never wants it, and it is checked before every other rule.
     */
    unpromptedSpeech: boolean;
    wakePhrase: {
      enabled: boolean;
      modelId: 'stt-phrase-v1';
      phrase: string;
      sensitivity: number;
    };
  };
  vad: {
    calibrationMs: number;
    minimumSpeechMs: number;
    silenceMs: number;
    maximumUtteranceMs: number;
    sensitivity: number;
  };
  connections: {
    openAICompatible: {
      baseUrl: string;
      credentialId: string | null;
    };
  };
  stt: {
    providerId: 'local-sherpa' | 'openai-compatible';
    modelId: string;
    language: string;
  };
  /**
   * What to do with a transcript before anyone acts on it.
   *
   * Held beside `stt` rather than inside it because these rules apply to text
   * however it was produced — the local Whisper, a remote endpoint, or a
   * speech-to-speech provider that was never configured here at all.
   */
  transcript: TranscriptRules;
  tts: {
    /**
     * Where audio.cpp runs.
     *
     * Only the audio.cpp engines read it — sherpa has no GPU path at all. The
     * two voices that take a direction are unusable on a processor and say so
     * rather than taking a minute a sentence; see `requiresBackend` in
     * `audioCppEngineSpecs.ts`.
     */
    backend: VoiceEngineBackend;
    providerId: SynthesisProviderId;
    modelId: string;
    profileId: string;
    language: string;
    speed: number;
    /**
     * Generation parameters, per model id.
     *
     * Kept per model rather than per engine because two audio.cpp models share
     * an engine and share none of its knobs: Chatterbox has `exaggeration`,
     * IndexTTS2 has `num_beams`, and a value carried across would be rejected
     * as an unknown key by whichever model received it.
     */
    params: Record<string, VoiceParams>;
  };
  narrator:
    | {
        mode: 'deterministic';
        language: 'tr' | 'en';
        maxSpokenCharacters: number;
      }
    | {
        mode: 'openai-compatible';
        language: 'tr' | 'en';
        modelId: string;
        timeoutMs: number;
        maxSpokenCharacters: number;
      };
  /**
   * Speaking a short English briefing rather than the reply itself.
   *
   * The installed voices are English; handed Turkish they produce something
   * between an accent and a mangling, and a whole reply is far too long to sit
   * through. On by default for that reason, and off in one click for anyone who
   * would rather hear the reply as written.
   */
  summary: {
    translateToEnglish: boolean;
    /** Empty means: whichever local model is loaded, or the last one used. */
    modelId: string;
    timeoutMs: number;
  };
  /**
   * The agent and model a spoken turn runs on.
   *
   * Talking to the pet is its own way of working, and it should not depend on
   * where the home page happens to be pointed. Pinning them here means the same
   * agent and the same model answer every time the wake word is heard, whatever
   * was last selected by hand.
   *
   * All three empty keeps the old behaviour: the turn inherits whatever the home
   * page would have used.
   */
  session: {
    /**
     * Assistant id, as the assistant list reports it.
     *
     * Defaults to {@link VOICE_DEFAULT_ASSISTANT_ID} rather than to nothing.
     * Left empty this fell back to the first enabled agent, and the only one
     * shipped enabled was the app's setup butler — so "find me some mods and
     * open them" went to the assistant whose job is registering MCP servers.
     * A default the user can change beats a default nobody chose.
     */
    assistantId: string;
    /**
     * Let a spoken task act without stopping to ask.
     *
     * A conversation held out loud has no way to answer a confirmation. The
     * prompt appears in a chat window the user is not looking at, the task
     * waits on it until it times out, and the model — having called a tool and
     * received nothing back — reports the work as done. "I've opened your
     * browser and searched for Spider-Man", with nothing opened and nothing
     * searched.
     *
     * So a spoken task runs unattended by default, because the alternative is
     * not "safer", it is broken: the same actions attempted, none completed,
     * and a false report of success. Switchable from the panel beside the
     * microphone for anyone who would rather a task stall than proceed.
     */
    unattended: boolean;
    /** Provider holding the model. Empty leaves the model to the assistant. */
    providerId: string;
    modelId: string;
    /**
     * Send the app's screen with a spoken turn, when the model can look at it.
     *
     * Talking to something across the room and then having to describe what is on
     * screen defeats the point. Skipped in silence for a text-only model.
     */
    attachScreenshot: boolean;
    /**
     * What that screenshot is *of*.
     *
     * `window` photographs the app's own view of itself and nothing else, which
     * is why it is the default — a voice assistant that silently starts
     * photographing the whole desktop is not a setting anyone should acquire by
     * upgrading. `screen` photographs the display the pointer is on, which is
     * what "look at this error" actually needs, and is opted into.
     */
    screenshotSource: 'window' | 'screen';
    /**
     * Which orb the desktop pet becomes while a conversation is running.
     *
     * A skin id from the orb registry. Empty means the default, and an id that
     * no longer names a skin falls back to it too — a look removed in a later
     * version must not leave somebody with a blank square on top of everything
     * they are doing and no obvious way to work out why.
     */
    orbSkin: string;
  };
  /**
   * The spoken conversation mode: who answers, in whose voice, as whom.
   *
   * Separate from `stt`/`tts` because nothing is shared with them. Those two
   * describe a pipeline this app assembles — transcribe, think, synthesise — and
   * every stage is separately chosen. A speech-to-speech provider is one model
   * that hears and speaks, so the only things left to choose are which one, what
   * it sounds like, and who it is being.
   */
  realtime: {
    providerId: 'openai-realtime' | 'gemini-live' | 'local-s2s' | 'local-pipeline';
    /**
     * Whether a spoken conversation runs on the agent runtime rather than on the
     * renderer's own loop.
     *
     * The renderer's loop was written when there was nothing else: eighteen
     * tools, four tool rounds, twelve turns of history and no compaction, while
     * the capable runtime sat one process away and was handed only the jobs the
     * conversation could not do itself. On the agent runtime a spoken
     * conversation gets the same tools, context handling and skills as a typed
     * one.
     *
     * On. The measurement in
     * `docs/specs/2026-08-08-one-harness-measurements.md` is what opened it: the
     * long tail of tools is described only when asked for, which took 36% off
     * every prompt, and the compactor now works against the window the model
     * actually has rather than a 200k default no small model ever reaches.
     *
     * What it does not buy is a faster first word — that is still the model's
     * own latency. It is off in the two places where the small loop is the
     * better answer: a machine that cannot open the session at all falls back to
     * it, and a user who wants the old behaviour turns this off.
     */
    useAgentRuntime: boolean;
    /** Empty means the provider's own default, which is what most users want. */
    model: string;
    /**
     * Where the thinking half of `local-pipeline` answers.
     *
     * Only that provider reads it. Empty means LM Studio on its own port, which
     * is what is running on the machines this option exists for; a user who
     * moved it, or who runs Ollama's OpenAI-compatible endpoint instead, points
     * this at their own.
     */
    localEndpoint: string;
    /**
     * The model that looks at the screen when the conversation asks it to.
     *
     * Separate from {@link model} because seeing and talking are not the same
     * job and are rarely the same weights: the fast model that holds a
     * conversation may be text-only, and the one that reads a screen well is
     * usually too slow to converse with. Empty means "use the thinking model",
     * which is right when it happens to have vision — and if it does not, the
     * request fails with something the user can act on rather than silently
     * dropping the picture.
     */
    visionModel: string;
    voice: string;
    personaPresetId: 'companion' | 'english-teacher' | 'language-partner' | 'interview-coach' | 'custom';
    /** Added to the preset, or the whole persona when the preset is `custom`. */
    customInstructions: string;
    /** A language to hold to, or `auto` to follow whoever is speaking. */
    language: string;
  };
  playback: {
    volume: number;
    /**
     * Whether the interrupt word can cut a reply short at all.
     *
     * A real setting rather than a constant, because it was a constant `true`
     * and cancelling a reply took a single loud frame — so any sound in the room
     * destroyed the answer while it was still being written, before a word of it
     * was spoken and with nothing on screen to say why. Switched off, nothing
     * cuts in: a reply always finishes, and whatever was said during it is
     * answered afterwards.
     */
    interruptible: boolean;
    /**
     * The one thing that stops it mid-sentence.
     *
     * Nothing else does. Not a cough, not a keystroke, not "mhm" or "evet", and
     * not another question — those wait their turn. This is deliberately a word
     * rather than a sound level: a level cannot tell a chair from a sentence, and
     * every attempt to guess from the audio alone threw away answers the user
     * wanted. One word, chosen by the user, is unambiguous in a way no threshold
     * is.
     *
     * Matched with the same whole-word, accent-folding comparison the wake phrase
     * uses, so a single word has to be heard exactly — `durum` does not stop
     * anything — and whatever follows it in the same breath becomes the next
     * question.
     */
    interruptPhrase: string;
    fallbackToDefaultDevice: boolean;
    /**
     * Read the reply itself aloud, rather than a briefing about it.
     *
     * The English summary exists to make a long Turkish answer listenable
     * through an English voice, which is the right trade when speech is a
     * summary of work that happened. Switched on here, the point is to hear the
     * answer — so the summariser is skipped entirely and the reply is spoken as
     * written. Passing it through a model would be the one thing the user asked
     * not to happen.
     */
    autoReadAloud: boolean;
  };
  agentOverrides: Record<string, FoolVoiceAgentOverride>;
};

/** The phrase that starts a spoken conversation with no click. */
export const WAKE_PHRASE_DEFAULT = 'wake up fool';

/**
 * The shipped desktop-wide shortcut for starting a spoken turn.
 *
 * Chosen for being unclaimed: Windows, macOS and the common editors all leave
 * Control/Command+Alt+V alone. Anything already taken is reported rather than
 * silently doing nothing.
 */
export const PUSH_TO_TALK_DEFAULT = 'Control+Alt+V';

/**
 * The assistant a spoken conversation hands its work to, until told otherwise.
 *
 * `the-fool` is the shipped personal assistant: it can see the screen, drive
 * the machine, write code and research, which is what a request made out loud
 * usually needs.
 *
 * Named here rather than left empty. Empty meant "the first enabled agent", and
 * the only assistant shipped enabled was the app's own setup butler — so asking
 * the voice to find some mods and open them went to the assistant whose job is
 * registering MCP servers and diagnosing stuck conversations. The picker beside
 * the microphone changes it, and a stored choice always wins over this.
 */
export const VOICE_DEFAULT_ASSISTANT_ID = 'the-fool';

/**
 * The shape of a stored settings record.
 *
 * 1 — as shipped before the shortcut did anything.
 * 2 — the shortcut is live, so a record that never chose one is given the default.
 * 3 — the detector's floor is one a normal speaking voice actually clears.
 * 4 — cloning is Pocket's, so a voice cloned on the old engine moves across.
 */
export const FOOL_VOICE_SCHEMA_VERSION = 4;

/** The engine cloned voices were rendered by before Pocket. */
const LEGACY_CLONING_MODEL_ID = 'tts-zipvoice-distill-int8';

/** The engine they are rendered by now, and the one a new record defaults to. */
export const CLONING_MODEL_ID = 'tts-pocket-int8-2026-01-26';

/**
 * Pocket through audio.cpp rather than sherpa.
 *
 * The same 122 MB weights that already answer in a second or two here, reached
 * through the engine that can carry generation parameters. Sherpa's synthesis
 * call takes `{ text, sid, speed }` and nothing else, so every knob Pocket
 * actually reads — temperature, the end-of-speech threshold, the noise clamp —
 * was unreachable from inside the app.
 */
export const AUDIOCPP_POCKET_MODEL_ID = 'tts-audiocpp-pocket';
export const AUDIOCPP_CHATTERBOX_MODEL_ID = 'tts-audiocpp-chatterbox';
export const AUDIOCPP_QWEN3_MODEL_ID = 'tts-audiocpp-qwen3-customvoice';
export const AUDIOCPP_SUPERTONIC_MODEL_ID = 'tts-audiocpp-supertonic-3';

/**
 * Every engine that can speak in a voice it was not trained on.
 *
 * A cloned voice is a recording the user owns, not a trained artefact, so the
 * same clip is offered against each of these — which is why a profile's model
 * id, not its own id, is what says which engine will render it.
 */
export const CLONING_ENGINES: readonly { modelId: string; providerId: LocalVoiceProviderId }[] = [
  { modelId: CLONING_MODEL_ID, providerId: 'local-sherpa' },
  { modelId: AUDIOCPP_POCKET_MODEL_ID, providerId: 'local-audiocpp' },
  { modelId: AUDIOCPP_CHATTERBOX_MODEL_ID, providerId: 'local-audiocpp' },
];

export const CLONING_MODEL_IDS: readonly string[] = CLONING_ENGINES.map((engine) => engine.modelId);

/**
 * Cloning engines that need the reference clip's transcript, word for word.
 *
 * ZipVoice aligns the new text against what the clip says, so a wrong transcript
 * is heard as the voice mispronouncing itself and a missing one produces noise.
 * Pocket, Chatterbox and IndexTTS2 build a speaker embedding from the audio
 * alone and never read a transcript — insisting on one there asks the user to
 * type something no engine will look at.
 */
const TRANSCRIPT_REQUIRED_MODEL_IDS: ReadonlySet<string> = new Set([LEGACY_CLONING_MODEL_ID]);

export const cloningRequiresTranscript = (modelId: string): boolean => TRANSCRIPT_REQUIRED_MODEL_IDS.has(modelId);

/** True when any of the engines a clip will be offered to reads its transcript. */
export const anyCloningEngineRequiresTranscript = (modelIds: readonly string[] = CLONING_MODEL_IDS): boolean =>
  modelIds.some(cloningRequiresTranscript);

/** The least a caller has to know about a model to address a request about it. */
type ProviderOwnedModel = { id: string; providerId: VoiceProviderId };

const providerOf = (models: readonly ProviderOwnedModel[], modelId: string): VoiceProviderId | undefined =>
  models.find((model) => model.id === modelId)?.providerId;

/**
 * Which provider speaks a given model.
 *
 * Every synthesis call site used to name `local-sherpa` outright, which was true
 * while sherpa was the only engine that could speak. Sending a Chatterbox voice
 * there now gets it refused as an unknown model, and the refusal reads as a
 * broken download rather than a misrouted request.
 *
 * Falls back rather than failing: the catalog arrives asynchronously, so a
 * request can be built before the model list has loaded, and sherpa is what
 * every one of these calls assumed before this function existed.
 */
export const synthesisProviderFor = (models: readonly ProviderOwnedModel[], modelId: string): SynthesisProviderId => {
  const providerId = providerOf(models, modelId);
  return providerId === 'local-audiocpp' || providerId === 'openai-compatible' ? providerId : 'local-sherpa';
};

/**
 * Which provider installs and removes a given model.
 *
 * Narrower than {@link synthesisProviderFor} on purpose: only a local provider
 * has anything on disk, so a remote model's own provider is not an answer the
 * download and remove endpoints accept.
 */
export const localProviderFor = (models: readonly ProviderOwnedModel[], modelId: string): LocalVoiceProviderId =>
  providerOf(models, modelId) === 'local-audiocpp' ? 'local-audiocpp' : 'local-sherpa';

/** The phrase shipped before {@link WAKE_PHRASE_DEFAULT}, upgraded on read. */
export const WAKE_PHRASE_LEGACY_DEFAULT = 'hey fool';

/**
 * How readily the wake phrase is accepted, on a fresh install.
 *
 * Lowered from 0.65: the phrase had to be said deliberately at the microphone
 * to be heard, which is not what a wake word is for.
 */
export const WAKE_SENSITIVITY_DEFAULT = 0.3;

/**
 * The detector sensitivity shipped before it was measured.
 *
 * Paired with the old noise floor it put the bar for speech around an RMS of
 * 0.12, which an ordinary speaking voice does not reach — the microphone was
 * open and simply never heard anything. Records still carrying this exact value
 * never chose it, so they are moved to the current default once.
 */
const VAD_SENSITIVITY_LEGACY_DEFAULT = 0.55;

/** How readily a frame counts as speech. Higher hears more. */
export const VAD_SENSITIVITY_DEFAULT = 0.75;

export const DEFAULT_FOOL_VOICE_SETTINGS: FoolVoiceSettings = {
  schemaVersion: FOOL_VOICE_SCHEMA_VERSION,
  enabled: false,
  devices: {
    inputDeviceId: null,
    outputDeviceId: null,
  },
  activation: {
    talkModeEnabled: false,
    pushToTalkShortcut: PUSH_TO_TALK_DEFAULT,
    // Off: talking without touching anything is the reason to have this at all.
    conversationHoldToTalk: false,
    unpromptedSpeech: true,
    wakePhrase: {
      // On by default because the desktop pet is the real switch: the listener
      // only opens the microphone while the pet is on screen.
      enabled: true,
      modelId: 'stt-phrase-v1',
      phrase: WAKE_PHRASE_DEFAULT,
      sensitivity: WAKE_SENSITIVITY_DEFAULT,
    },
  },
  vad: {
    calibrationMs: 1000,
    minimumSpeechMs: 250,
    silenceMs: 800,
    maximumUtteranceMs: 30000,
    sensitivity: VAD_SENSITIVITY_DEFAULT,
  },
  connections: {
    openAICompatible: {
      baseUrl: 'https://api.openai.com/v1',
      credentialId: null,
    },
  },
  stt: {
    providerId: 'local-sherpa',
    modelId: 'stt-whisper-turbo',
    language: 'auto',
  },
  transcript: DEFAULT_TRANSCRIPT_RULES,
  tts: {
    // The engine everyone has. Switching to `cuda` is opt-in because it is an
    // 800 MB download, and the default voice does not need it.
    backend: 'cpu',
    providerId: 'local-sherpa',
    modelId: 'tts-piper-en-libritts-r',
    profileId: 'libritts-p0',
    language: 'en',
    speed: 1,
    params: {},
  },
  narrator: {
    mode: 'deterministic',
    language: 'en',
    maxSpokenCharacters: 600,
  },
  summary: {
    translateToEnglish: true,
    modelId: '',
    // Generous on purpose: a local model that has to load its weights, or one
    // that thinks before answering, is slow once and fast afterwards. The pet
    // says what the wait is for, so a long ceiling costs nothing in the normal
    // case and saves the first answer of a session in the slow one.
    timeoutMs: 45000,
  },
  session: {
    assistantId: VOICE_DEFAULT_ASSISTANT_ID,
    unattended: true,
    providerId: '',
    modelId: '',
    attachScreenshot: true,
    screenshotSource: 'window',
    orbSkin: DEFAULT_ORB_SKIN,
  },
  realtime: {
    // The local pipeline by default: it is the only one of the four that can
    // hold a conversation with nothing bought and no key entered, and the
    // models it needs are the ones the voice settings already install.
    providerId: 'local-pipeline',
    // Off until measured — see the field's own note.
    useAgentRuntime: true,
    model: '',
    localEndpoint: '',
    visionModel: '',
    voice: 'marin',
    personaPresetId: 'companion',
    customInstructions: '',
    language: 'auto',
  },
  playback: {
    volume: 0.85,
    interruptible: true,
    // One syllable, and the same word in most of the languages this app speaks —
    // and one word has to be heard exactly, so a short unambiguous one is what
    // works. Changed in the same panel that starts the conversation.
    interruptPhrase: 'stop',
    fallbackToDefaultDevice: true,
    autoReadAloud: false,
  },
  agentOverrides: {},
};

const identifierSchema = z.string().min(1).max(128);
const languageSchema = z.string().min(1).max(32);
const containsControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
const normalizedWakePhraseSchema = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .refine((value) => value.length >= 2 && value.length <= 64 && !containsControlCharacter(value));
const httpBaseUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  });

/**
 * A stored parameter value, bounded but not schema-checked here.
 *
 * The engine's own schema is what decides whether `top_p: 3` is legal, and it
 * lives in the main process next to the provider that sends it. Settings
 * storage only has to refuse a value that could not be a parameter at all — an
 * object, an array, an unbounded string.
 */
const paramValueSchema = z.union([z.number().finite(), z.boolean(), z.string().max(512)]);

const paramsSchema = z
  .record(z.string().min(1).max(64), paramValueSchema)
  .refine((params) => Object.keys(params).length <= 64);

const overrideSchema = z
  .object({
    narrationEnabled: z.boolean().optional(),
    tts: z
      .object({
        providerId: z.enum(['local-sherpa', 'local-audiocpp', 'openai-compatible']).optional(),
        modelId: identifierSchema.optional(),
        profileId: identifierSchema.optional(),
        language: languageSchema.optional(),
        speed: z.number().min(0.5).max(2).optional(),
      })
      .strict()
      .optional(),
    narrator: z
      .object({
        language: z.enum(['tr', 'en']).optional(),
        maxSpokenCharacters: z.number().int().min(120).max(1200).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const settingsSchema = z
  .object({
    schemaVersion: z.number().int().min(1).max(1000).default(FOOL_VOICE_SCHEMA_VERSION),
    enabled: z.boolean().default(false),
    devices: z
      .object({
        inputDeviceId: z.string().max(512).nullable().default(null),
        outputDeviceId: z.string().max(512).nullable().default(null),
      })
      .strict()
      .default({}),
    activation: z
      .object({
        talkModeEnabled: z.boolean().default(false),
        pushToTalkShortcut: z.string().max(128).default(PUSH_TO_TALK_DEFAULT),
        conversationHoldToTalk: z.boolean().default(false),
        // Defaults on, matching DEFAULT_FOOL_VOICE_SETTINGS: a record written
        // before this existed reads as somebody who never turned it off.
        unpromptedSpeech: z.boolean().default(true),
        wakePhrase: z
          .object({
            enabled: z.boolean().default(true),
            modelId: z.literal('stt-phrase-v1').default('stt-phrase-v1'),
            phrase: normalizedWakePhraseSchema.default(WAKE_PHRASE_DEFAULT),
            // Matches DEFAULT_FOOL_VOICE_SETTINGS. The two were allowed to
            // drift when the shipped value was lowered, so a record with no
            // stored sensitivity parsed to a bar twice as high as a fresh
            // install's — the same phrase heard on one machine and not the
            // other, with nothing in the settings to explain it.
            sensitivity: z.number().min(0).max(1).default(WAKE_SENSITIVITY_DEFAULT),
          })
          .strict()
          .default({}),
      })
      .strict()
      .default({}),
    vad: z
      .object({
        calibrationMs: z.number().int().min(250).max(5000).default(1000),
        minimumSpeechMs: z.number().int().min(100).max(2000).default(250),
        silenceMs: z.number().int().min(250).max(5000).default(800),
        maximumUtteranceMs: z.number().int().min(3000).max(120000).default(30000),
        sensitivity: z.number().min(0).max(1).default(VAD_SENSITIVITY_DEFAULT),
      })
      .strict()
      .default({}),
    connections: z
      .object({
        openAICompatible: z
          .object({
            baseUrl: httpBaseUrlSchema.default('https://api.openai.com/v1'),
            credentialId: identifierSchema.nullable().default(null),
          })
          .strict()
          .default({}),
      })
      .strict()
      .default({}),
    stt: z
      .object({
        providerId: z.enum(['local-sherpa', 'openai-compatible']).default('local-sherpa'),
        modelId: identifierSchema.default('stt-whisper-turbo'),
        language: languageSchema.default('auto'),
      })
      .strict()
      .default({}),
    transcript: z
      .object({
        removeFillers: z.boolean().default(true),
        selfCorrection: z.boolean().default(true),
        collapseRepeats: z.boolean().default(true),
        // A speaker's own hesitations, not a word list: short entries, and few
        // enough that the rule stays something a person can reason about.
        customFillers: z.array(z.string().min(1).max(32)).max(64).default([]),
      })
      .strict()
      .default({}),
    tts: z
      .object({
        backend: z.enum(['cpu', 'cuda']).default('cpu'),
        providerId: z.enum(['local-sherpa', 'local-audiocpp', 'openai-compatible']).default('local-sherpa'),
        modelId: identifierSchema.default('tts-piper-en-libritts-r'),
        profileId: identifierSchema.default('libritts-p0'),
        language: languageSchema.default('en'),
        speed: z.number().min(0.5).max(2).default(1),
        params: z
          .record(identifierSchema, paramsSchema)
          .refine((params) => Object.keys(params).length <= 32)
          .default({}),
      })
      .strict()
      .default({}),
    narrator: z
      .discriminatedUnion('mode', [
        z
          .object({
            mode: z.literal('deterministic'),
            language: z.enum(['tr', 'en']).default('en'),
            maxSpokenCharacters: z.number().int().min(120).max(1200).default(600),
          })
          .strict(),
        z
          .object({
            mode: z.literal('openai-compatible'),
            language: z.enum(['tr', 'en']).default('en'),
            modelId: identifierSchema,
            timeoutMs: z.number().int().min(1000).max(30000),
            maxSpokenCharacters: z.number().int().min(120).max(1200).default(600),
          })
          .strict(),
      ])
      .default({
        mode: 'deterministic',
        language: 'en',
        maxSpokenCharacters: 600,
      }),
    summary: z
      .object({
        translateToEnglish: z.boolean().default(true),
        // Longer than an identifier: LM Studio names models by their full
        // publisher/repo/file path, which routinely runs past 128 characters.
        modelId: z.string().max(256).default(''),
        timeoutMs: z.number().int().min(1000).max(120000).default(45000),
      })
      .strict()
      .default({}),
    session: z
      .object({
        assistantId: z.string().max(128).default(VOICE_DEFAULT_ASSISTANT_ID),
        unattended: z.boolean().default(true),
        providerId: z.string().max(128).default(''),
        modelId: z.string().max(256).default(''),
        attachScreenshot: z.boolean().default(true),
        screenshotSource: z.enum(['window', 'screen']).default('window'),
        // Free text rather than an enum of the ids that exist today: the
        // registry is meant to grow, and a schema that had to be edited for
        // every new look would be a second place to forget. An unknown id is
        // handled where it is used, by falling back.
        orbSkin: z.string().max(64).default(DEFAULT_ORB_SKIN),
      })
      .strict()
      .default({}),
    realtime: z
      .object({
        providerId: z.enum(['openai-realtime', 'gemini-live', 'local-s2s', 'local-pipeline']).default('local-pipeline'),
        useAgentRuntime: z.boolean().default(true),
        model: z.string().max(256).default(''),
        // Empty is the LM Studio default rather than an invalid URL, so the
        // field can be cleared to get back to it.
        localEndpoint: z.literal('').or(httpBaseUrlSchema).default(''),
        // Empty means the thinking model does the looking too.
        visionModel: z.string().max(256).default(''),
        voice: z.string().max(64).default('marin'),
        personaPresetId: z
          .enum(['companion', 'english-teacher', 'language-partner', 'interview-coach', 'custom'])
          .default('companion'),
        // Room for a real brief — a teaching persona with the learner's level,
        // their weak spots and the subjects they want to talk about runs to a
        // few paragraphs — and short of anything that could be a pasted
        // transcript.
        customInstructions: z.string().max(4000).default(''),
        language: languageSchema.default('auto'),
      })
      .strict()
      .default({}),
    playback: z
      .object({
        volume: z.number().min(0).max(1).default(0.85),
        interruptible: z.boolean().default(true),
        // Short, because a phrase this is compared against word by word wants to
        // be one or two words. Empty is not allowed: it would match everything.
        interruptPhrase: z.string().trim().min(1).max(64).default('stop'),
        fallbackToDefaultDevice: z.boolean().default(true),
        autoReadAloud: z.boolean().default(false),
      })
      .strict()
      .default({}),
    agentOverrides: z
      .record(identifierSchema, overrideSchema)
      .refine((overrides) => Object.keys(overrides).length <= 128)
      .default({}),
  })
  .strict();

export type FoolVoiceDiagnostic = {
  code: 'invalid-settings';
  key: 'fool.voice';
};

export const parseFoolVoiceSettings = (value: unknown): FoolVoiceSettings =>
  settingsSchema.parse(value) as FoolVoiceSettings;

export const loadFoolVoiceSettings = (
  value: unknown,
  onDiagnostic?: (diagnostic: FoolVoiceDiagnostic) => void
): FoolVoiceSettings => {
  const result = settingsSchema.safeParse(value);
  if (result.success) return upgradeSettings(result.data as FoolVoiceSettings);
  onDiagnostic?.({ code: 'invalid-settings', key: 'fool.voice' });
  return structuredClone(DEFAULT_FOOL_VOICE_SETTINGS);
};

/**
 * Fills in a shortcut for settings written before there was one.
 *
 * A schema default only applies to an absent key, and these records already carry
 * `pushToTalkShortcut: ""` from when the field existed but nothing read it. Every
 * one of those empty strings means "never chosen", not "deliberately cleared" —
 * so it is filled in once, and the version bump is what keeps it to once. A
 * shortcut the user later clears stays cleared.
 */
const upgradeShortcut = (settings: FoolVoiceSettings): FoolVoiceSettings => {
  if (settings.schemaVersion >= FOOL_VOICE_SCHEMA_VERSION) return settings;

  return {
    ...settings,
    schemaVersion: FOOL_VOICE_SCHEMA_VERSION,
    activation: {
      ...settings.activation,
      pushToTalkShortcut: settings.activation.pushToTalkShortcut || PUSH_TO_TALK_DEFAULT,
    },
  };
};

/**
 * Moves a record still carrying the unmeasured sensitivity onto the current one.
 *
 * The old value was not a preference anyone expressed — it shipped as the
 * default and, with the noise floor it was paired with, set the bar for speech
 * above an ordinary speaking voice. A sensitivity the user actually chose is
 * left alone, and the version bump is what keeps this to once.
 */
const upgradeVadSensitivity = (settings: FoolVoiceSettings): FoolVoiceSettings => {
  if (settings.schemaVersion >= FOOL_VOICE_SCHEMA_VERSION) return settings;
  if (settings.vad.sensitivity !== VAD_SENSITIVITY_LEGACY_DEFAULT) return settings;

  return { ...settings, vad: { ...settings.vad, sensitivity: VAD_SENSITIVITY_DEFAULT } };
};

/**
 * Moves a voice cloned on the old engine onto the one that renders them now.
 *
 * The recording belongs to the user, not to the engine — the same clip is the
 * same voice whichever renders it — so a record still naming the old engine is
 * pointing at a voice that is very much still there. Left alone it would fall
 * through to "that model has no voices" and the reply would be spoken by a
 * stranger, which is a baffling way for a cloned voice to disappear.
 *
 * Only cloned profiles move. A preset voice on that engine was a real choice.
 */
const upgradeClonedVoiceEngine = (settings: FoolVoiceSettings): FoolVoiceSettings => {
  if (settings.schemaVersion >= FOOL_VOICE_SCHEMA_VERSION) return settings;
  if (settings.tts.modelId !== LEGACY_CLONING_MODEL_ID) return settings;
  if (!settings.tts.profileId.startsWith('cloned:')) return settings;

  return { ...settings, tts: { ...settings.tts, modelId: CLONING_MODEL_ID } };
};

/** Brings a stored record up to what this version of the app expects. */
export const upgradeSettings = (settings: FoolVoiceSettings): FoolVoiceSettings =>
  upgradeShortcut(upgradeVadSensitivity(upgradeWakePhrase(upgradeClonedVoiceEngine(settings))));

/**
 * Moves settings still carrying the old wake phrase onto the current one.
 *
 * Only the untouched default is replaced — a phrase the user chose is theirs and
 * is left exactly as it is.
 */
export const upgradeWakePhrase = (settings: FoolVoiceSettings): FoolVoiceSettings => {
  if (settings.activation.wakePhrase.phrase.toLowerCase() !== WAKE_PHRASE_LEGACY_DEFAULT) return settings;

  return {
    ...settings,
    activation: {
      ...settings.activation,
      wakePhrase: { ...settings.activation.wakePhrase, phrase: WAKE_PHRASE_DEFAULT, enabled: true },
    },
  };
};

type VoiceTurnPhaseState =
  | { phase: 'idle' }
  | { phase: 'wake-listening'; sessionId: string }
  | { phase: 'wake-detected'; sessionId: string; matchedPhrase: string }
  | { phase: 'command-listening'; sessionId: string; clientTurnId: string }
  | ({
      phase: 'transcribing';
      sessionId: string;
      operationId: string;
    } & ({ purpose: 'wake' } | { purpose: 'command'; clientTurnId: string }))
  | {
      phase: 'agent-running';
      sessionId: string;
      conversationId: string;
      turnId: string;
    }
  | {
      phase: 'narrating';
      sessionId: string;
      conversationId: string;
      turnId: string;
    }
  | {
      phase: 'speaking';
      sessionId: string;
      conversationId: string;
      turnId: string;
      operationId: string;
    };

type VoiceTurnCondition =
  | { status: 'normal' }
  | {
      status: 'muted';
      resetTarget: 'idle' | 'wake-listening';
    }
  | {
      status: 'degraded';
      reason: 'output-device-fallback' | 'narrator-fallback' | 'provider-degraded';
      fallbackActive: true;
    }
  | {
      status: 'cancelled';
      reason: 'user' | 'barge-in' | 'device-change' | 'talk-mode-closed' | 'superseded';
    }
  | {
      status: 'error';
      code: string;
      recoverable: boolean;
    };

export type VoiceTurnState = VoiceTurnPhaseState & {
  condition: VoiceTurnCondition;
  enteredAtMs: number;
};

const isResetPhase = (state: VoiceTurnState): boolean =>
  state.condition.status === 'normal' && (state.phase === 'idle' || state.phase === 'wake-listening');

export const isVoiceTurnTransitionAllowed = (
  current: VoiceTurnState,
  next: VoiceTurnState,
  options: { reset?: boolean } = {}
): boolean => {
  if (current.condition.status === 'cancelled' || current.condition.status === 'error') {
    return options.reset === true && isResetPhase(next);
  }
  if (current.condition.status === 'muted') {
    return (
      options.reset === true &&
      isResetPhase(next) &&
      (next.phase === current.condition.resetTarget ||
        (current.condition.resetTarget === 'idle' && next.phase === 'idle'))
    );
  }
  if (next.condition.status === 'cancelled' || next.condition.status === 'error' || next.condition.status === 'muted') {
    return next.phase === current.phase;
  }

  switch (current.phase) {
    case 'idle':
      return next.phase === 'wake-listening' || next.phase === 'command-listening';
    case 'wake-listening':
      return next.phase === 'transcribing' && next.purpose === 'wake';
    case 'wake-detected':
      return next.phase === 'command-listening';
    case 'command-listening':
      return next.phase === 'transcribing' && next.purpose === 'command';
    case 'transcribing':
      if (current.purpose === 'wake') {
        return next.phase === 'wake-detected' || next.phase === 'wake-listening';
      }
      return next.phase === 'agent-running';
    case 'agent-running':
      return next.phase === 'narrating';
    case 'narrating':
      return next.phase === 'speaking' || next.phase === 'narrating';
    case 'speaking':
      return next.phase === 'idle' || next.phase === 'wake-listening';
  }
};

export const isVoiceDownloadProgressTransitionAllowed = (
  current: VoiceDownloadProgress,
  next: VoiceDownloadProgress
): boolean => {
  if (current.state === 'ready' || current.state === 'cancelled' || current.state === 'failed') return false;
  if (
    current.operationId !== next.operationId ||
    current.providerId !== next.providerId ||
    current.modelId !== next.modelId ||
    next.sequence <= current.sequence ||
    next.attempt < current.attempt
  ) {
    return false;
  }
  return next.attempt > current.attempt || next.downloadedBytes >= current.downloadedBytes;
};

export type NarrationInput = {
  conversationId: string;
  turnId: string;
  language: 'tr' | 'en';
  userRequest: string;
  finalAgentAnswer: string;
  evidence: readonly { id: string }[];
  maxSpokenCharacters: number;
};

type NarrationOutputBase = {
  spokenText: string;
  language: 'tr' | 'en';
  sourceFactIds: readonly string[];
  confidence: 'high' | 'medium' | 'low';
};

export type NarrationOutput =
  | (NarrationOutputBase & {
      strategy: 'deterministic' | 'model';
      fallbackReason?: never;
    })
  | (NarrationOutputBase & {
      strategy: 'deterministic-fallback';
      fallbackReason:
        | 'provider-unavailable'
        | 'timeout'
        | 'invalid-output'
        | 'unsupported-language'
        | 'sanitized-empty';
    });

export type VoiceRequestEnvelope<T> = {
  version: 1;
  requestId: string;
  payload: T;
};

export type VoiceBridgeError = {
  code:
    | 'unavailable'
    | 'invalid-request'
    | 'not-found'
    | 'busy'
    | 'cancelled'
    | 'payload-too-large'
    | 'unsupported'
    | 'timeout'
    | 'security-rejected'
    | 'provider-failed';
  retryable: boolean;
  safeMessage?: string;
};

export type VoiceResponseEnvelope<T> =
  | { version: 1; requestId: string; ok: true; data: T }
  | { version: 1; requestId: string; ok: false; error: VoiceBridgeError };

export type VoiceEventEnvelope<T> = {
  version: 1;
  eventId: string;
  occurredAtMs: number;
  payload: T;
};

export type VoiceCatalogRequest = {
  includeProfiles: boolean;
  /**
   * Which audio.cpp build to answer "is it installed?" about.
   *
   * A model is only ready if the engine that can run it is on disk, and the two
   * builds are separate downloads — so switching a machine with the CPU build
   * to `cuda` correctly reports every audio.cpp voice as needing an install
   * again. Absent means the processor, which is what a caller that has not
   * heard of this setting wants.
   */
  backend?: VoiceEngineBackend;
};
export type VoiceCatalogResponse = {
  providers: readonly VoiceProvider[];
  models: readonly VoiceModel[];
  profiles: readonly VoiceProfile[];
};
export type VoiceDownloadRequest = {
  /** Which engine build to fetch alongside the weights. */
  backend?: VoiceEngineBackend;
  operationId: string;
  providerId: LocalVoiceProviderId;
  modelId: string;
};
export type VoiceDownloadResponse = { operationId: string; accepted: true };
export type VoiceRemoveRequest = {
  providerId: LocalVoiceProviderId;
  modelId: string;
};
export type VoiceRemoveResponse = {
  providerId: LocalVoiceProviderId;
  modelId: string;
  state: 'not-installed';
};
export type VoiceHealthRequest = {
  providerId: VoiceProviderId;
  /** Which audio.cpp build the check is about. Ignored by the other providers. */
  backend?: VoiceEngineBackend;
  capability?: VoiceCapability;
  modelId?: string;
};
/** Capture audio handed to transcription; always resampled to 16 kHz. */
export type VoicePcm16Wav = {
  encoding: 'base64';
  mimeType: 'audio/wav';
  sampleRateHz: 16000;
  channels: 1;
  sampleFormat: 'pcm16le';
  byteLength: number;
  dataBase64: string;
};

/**
 * Synthesised audio, which keeps the voice model's native rate.
 *
 * Speech models do not all emit 16 kHz — Piper produces 22.05 kHz and Kokoro
 * 24 kHz — so forcing the capture rate here would either reject valid audio or
 * require a lossy downsample before playback.
 */
export type VoiceSynthesizedWav = Omit<VoicePcm16Wav, 'sampleRateHz'> & {
  sampleRateHz: number;
};
export type VoiceTranscribeRequest = {
  operationId: string;
  providerId: 'local-sherpa' | 'openai-compatible';
  modelId: string;
  languageHint: string;
  audio: VoicePcm16Wav;
};
export type VoiceTranscribeResponse = {
  operationId: string;
  providerId: 'local-sherpa' | 'openai-compatible';
  modelId: string;
  text: string;
  detectedLanguage?: string;
  durationMs: number;
};

/**
 * Reference audio for a cloned voice.
 *
 * A wider band than {@link VoicePcm16Wav}: the cloning engine reads this
 * straight off disk rather than through a capture path fixed at 16 kHz, and
 * the same 16-or-24 kHz split this app's own references already use — a rate
 * outside it is rejected rather than resampled again on the way in.
 */
export type VoiceCloneReferenceWav = Omit<VoicePcm16Wav, 'sampleRateHz'> & { sampleRateHz: 16000 | 24000 };

export type VoiceCloneSaveRequest = {
  operationId: string;
  /** Becomes the on-disk folder name and the `cloned:<voiceId>` profile id — see `isValidVoiceId`. */
  voiceId: string;
  displayName: string;
  languages: string[];
  referenceText: string;
  audio: VoiceCloneReferenceWav;
};
export type VoiceCloneSaveResponse = {
  operationId: string;
  profileId: string;
};
export type VoiceDeleteClonedRequest = {
  voiceId: string;
};
export type VoiceDeleteClonedResponse = {
  voiceId: string;
  deleted: true;
};
export type VoiceSynthesizeRequest = {
  operationId: string;
  /** Where audio.cpp should run this. Ignored by the other providers. */
  backend?: VoiceEngineBackend;
  providerId: SynthesisProviderId;
  modelId: string;
  profileId: string;
  language: string;
  speed: number;
  text: string;
  /**
   * Engine-specific generation parameters, validated against the model's own
   * schema before they reach a provider.
   *
   * Kept as one open field rather than a union of every engine's knobs: the
   * schema in `audioCppEngineSpecs.ts` is the single place a parameter is
   * declared, and both this validator and the settings UI read from it. An
   * engine with no schema accepts no parameters at all.
   */
  params?: VoiceParams;
};
export type VoiceSynthesizeResponse = {
  operationId: string;
  providerId: SynthesisProviderId;
  modelId: string;
  profileId: string;
  audio: VoiceSynthesizedWav;
  durationMs: number;
};
export type VoiceSpeakersRequest = {
  providerId: LocalVoiceProviderId;
  modelId: string;
};
/**
 * How many speakers an installed model actually carries.
 *
 * Read from the loaded engine rather than from the catalog: LibriTTS-R ships 904
 * of them, far too many to list by hand, and a curated subset would quietly hide
 * most of the voices the user downloaded.
 */
export type VoiceSpeakersResponse = {
  modelId: string;
  speakerCount: number;
  /** `engine` means the model was opened; `catalog` is the preset fallback. */
  source: 'engine' | 'catalog';
};
/** Where the summarising model came from, for the settings page and for support. */
export type VoiceSummaryModelOrigin = 'configured' | 'loaded' | 'last-used' | 'installed' | 'none';

/**
 * Asked before summarising, so the wait can be explained.
 *
 * A local model that is installed but not loaded takes tens of seconds on its
 * first request. Knowing that in advance is what lets the pet say "waking the
 * model" instead of appearing to have frozen.
 */
export type VoiceSummaryPlanRequest = {
  /** The model the user pinned in settings; empty means choose automatically. */
  modelId: string;
  /** The model that last produced a summary; empty when there has not been one. */
  lastUsedModelId: string;
};
export type VoiceSummaryPlanResponse = {
  /** Empty when nothing on this machine can summarise. */
  modelId: string;
  displayName: string;
  /** False when the host has to load the weights before it can answer. */
  loaded: boolean;
  /** True when the model runs on this machine. */
  local: boolean;
  origin: VoiceSummaryModelOrigin;
};

export type VoiceSummarizeRequest = {
  operationId: string;
  /** The model chosen by {@link VoiceSummaryPlanResponse}; empty resolves again. */
  modelId: string;
  text: string;
  timeoutMs: number;
  maxCharacters: number;
};
export type VoiceSummarizeResponse = {
  operationId: string;
  /** The English briefing, or the text unchanged when no model could produce one. */
  text: string;
  modelId: string;
  source: 'model' | 'original';
  /**
   * True when the briefing came back in English.
   *
   * A small local model sometimes shortens the reply but keeps its language. That
   * is still a better thing to speak than the whole reply, so it is used — but
   * the caller is told, because it is not what was asked for.
   */
  translated: boolean;
  /** Why the model was not used. Absent when it was. */
  reason?: 'no-model' | 'unreachable' | 'timeout' | 'empty-output';
};

/**
 * The shortcut that starts a spoken turn from anywhere on the desktop.
 *
 * Registered in the main process, because the point of it is to work while the
 * app is not the focused window. An empty accelerator unregisters.
 */
export type VoiceShortcutRequest = { accelerator: string };
export type VoiceShortcutResponse = {
  accelerator: string;
  registered: boolean;
  /**
   * `invalid` — not an accelerator Electron accepts.
   * `taken` — something else on the desktop already holds it.
   * `unsupported` — no global shortcuts on this platform or build.
   */
  reason?: 'invalid' | 'taken' | 'unsupported';
};

export type VoiceCancelRequest = { operationId: string };
export type VoiceCancelResponse = {
  operationId: string;
  state: 'cancelling' | 'cancelled' | 'not-found' | 'already-terminal';
};

export type VoiceRealtimeEnsureRequest = {
  modelId?: string;
  voiceId?: string;
};
export type VoiceRealtimeEnsureResponse = {
  endpoint: string;
  reused: boolean;
};

/**
 * Asking the main process where — and as whom — to open a spoken conversation.
 *
 * The model is part of the request because the credential can depend on it: a
 * minted client secret is issued against the session it will be used for, so the
 * process cannot mint one without knowing which model the window is about to
 * ask for.
 */
export type VoiceRealtimeSessionRequest = {
  providerId: string;
  model: string;
};

export type VoiceRealtimeSessionResponse = {
  providerId: string;
  /** Empty for the local pipeline, which is not authenticated. */
  token: string;
  /** Empty where the adapter already knows the provider's fixed address. */
  endpoint: string;
  /** True when the token is short-lived and a later session must ask again. */
  ephemeral: boolean;
  /** The provider record's own name, so the page can say which account is paying. */
  providerName: string;
};
