/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

export type VoiceProviderId = 'local-sherpa' | 'openai-compatible' | 'transcript-wake-word';
export type VoiceProviderKind = 'local' | 'remote' | 'derived';
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
      reason: 'archive-invalid' | 'manifest-mismatch' | 'missing-files';
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
  providerId: 'local-sherpa';
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

export type FoolVoiceAgentOverride = {
  narrationEnabled?: boolean;
  tts?: {
    providerId?: 'local-sherpa' | 'openai-compatible';
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
  tts: {
    providerId: 'local-sherpa' | 'openai-compatible';
    modelId: string;
    profileId: string;
    language: string;
    speed: number;
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
    /** Assistant id, as the assistant list reports it. */
    assistantId: string;
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
  };
  playback: {
    volume: number;
    interruptible: true;
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

/** The engine they are rendered by now. */
export const CLONING_MODEL_ID = 'tts-pocket-int8-2026-01-26';

/** The phrase shipped before {@link WAKE_PHRASE_DEFAULT}, upgraded on read. */
export const WAKE_PHRASE_LEGACY_DEFAULT = 'hey fool';

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
    wakePhrase: {
      // On by default because the desktop pet is the real switch: the listener
      // only opens the microphone while the pet is on screen.
      enabled: true,
      modelId: 'stt-phrase-v1',
      phrase: WAKE_PHRASE_DEFAULT,
      sensitivity: 0.65,
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
  tts: {
    providerId: 'local-sherpa',
    modelId: 'tts-piper-en-libritts-r',
    profileId: 'libritts-p0',
    language: 'en',
    speed: 1,
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
    assistantId: '',
    providerId: '',
    modelId: '',
    attachScreenshot: true,
  },
  playback: {
    volume: 0.85,
    interruptible: true,
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

const overrideSchema = z
  .object({
    narrationEnabled: z.boolean().optional(),
    tts: z
      .object({
        providerId: z.enum(['local-sherpa', 'openai-compatible']).optional(),
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
        wakePhrase: z
          .object({
            enabled: z.boolean().default(true),
            modelId: z.literal('stt-phrase-v1').default('stt-phrase-v1'),
            phrase: normalizedWakePhraseSchema.default(WAKE_PHRASE_DEFAULT),
            sensitivity: z.number().min(0).max(1).default(0.65),
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
    tts: z
      .object({
        providerId: z.enum(['local-sherpa', 'openai-compatible']).default('local-sherpa'),
        modelId: identifierSchema.default('tts-piper-en-libritts-r'),
        profileId: identifierSchema.default('libritts-p0'),
        language: languageSchema.default('en'),
        speed: z.number().min(0.5).max(2).default(1),
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
        assistantId: z.string().max(128).default(''),
        providerId: z.string().max(128).default(''),
        modelId: z.string().max(256).default(''),
        attachScreenshot: z.boolean().default(true),
      })
      .strict()
      .default({}),
    playback: z
      .object({
        volume: z.number().min(0).max(1).default(0.85),
        interruptible: z.literal(true).default(true),
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

export type VoiceCatalogRequest = { includeProfiles: boolean };
export type VoiceCatalogResponse = {
  providers: readonly VoiceProvider[];
  models: readonly VoiceModel[];
  profiles: readonly VoiceProfile[];
};
export type VoiceDownloadRequest = {
  operationId: string;
  providerId: 'local-sherpa';
  modelId: string;
};
export type VoiceDownloadResponse = { operationId: string; accepted: true };
export type VoiceRemoveRequest = {
  providerId: 'local-sherpa';
  modelId: string;
};
export type VoiceRemoveResponse = {
  providerId: 'local-sherpa';
  modelId: string;
  state: 'not-installed';
};
export type VoiceHealthRequest = {
  providerId: VoiceProviderId;
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
  providerId: 'local-sherpa' | 'openai-compatible';
  modelId: string;
  profileId: string;
  language: string;
  speed: number;
  text: string;
};
export type VoiceSynthesizeResponse = {
  operationId: string;
  providerId: 'local-sherpa' | 'openai-compatible';
  modelId: string;
  profileId: string;
  audio: VoiceSynthesizedWav;
  durationMs: number;
};
export type VoiceSpeakersRequest = {
  providerId: 'local-sherpa';
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
