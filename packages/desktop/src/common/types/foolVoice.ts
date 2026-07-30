/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
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
  schemaVersion: 1;
  enabled: boolean;
  devices: {
    inputDeviceId: string | null;
    outputDeviceId: string | null;
  };
  activation: {
    talkModeEnabled: boolean;
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
  playback: {
    volume: number;
    interruptible: true;
    fallbackToDefaultDevice: boolean;
  };
  agentOverrides: Record<string, FoolVoiceAgentOverride>;
};

/** The phrase that starts a spoken conversation with no click. */
export const WAKE_PHRASE_DEFAULT = 'wake up fool';

/** The phrase shipped before {@link WAKE_PHRASE_DEFAULT}, upgraded on read. */
export const WAKE_PHRASE_LEGACY_DEFAULT = 'hey fool';

export const DEFAULT_FOOL_VOICE_SETTINGS: FoolVoiceSettings = {
  schemaVersion: 1,
  enabled: false,
  devices: {
    inputDeviceId: null,
    outputDeviceId: null,
  },
  activation: {
    talkModeEnabled: false,
    pushToTalkShortcut: '',
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
    sensitivity: 0.55,
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
  playback: {
    volume: 0.85,
    interruptible: true,
    fallbackToDefaultDevice: true,
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
    schemaVersion: z.literal(1).default(1),
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
        pushToTalkShortcut: z.string().max(128).default(''),
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
        sensitivity: z.number().min(0).max(1).default(0.55),
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
    playback: z
      .object({
        volume: z.number().min(0).max(1).default(0.85),
        interruptible: z.literal(true).default(true),
        fallbackToDefaultDevice: z.boolean().default(true),
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
  if (result.success) return upgradeWakePhrase(result.data as FoolVoiceSettings);
  onDiagnostic?.({ code: 'invalid-settings', key: 'fool.voice' });
  return structuredClone(DEFAULT_FOOL_VOICE_SETTINGS);
};

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
export type VoiceCancelRequest = { operationId: string };
export type VoiceCancelResponse = {
  operationId: string;
  state: 'cancelling' | 'cancelled' | 'not-found' | 'already-terminal';
};
