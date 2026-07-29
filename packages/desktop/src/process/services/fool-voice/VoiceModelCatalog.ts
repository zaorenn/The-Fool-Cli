import type { VoiceModel } from '../../../common/types/foolVoice';

export const FOOL_VOICE_MODELS: readonly VoiceModel[] = [
  {
    id: 'stt-whisper-tiny-int8-v1',
    providerId: 'local-sherpa',
    displayName: 'Whisper Tiny (Multilingual, int8)',
    languages: ['tr', 'en'],
    role: 'speech-to-text',
    distribution: 'managed',
    state: { status: 'not-installed' },
    downloadBytes: null,
    installedBytes: null,
    audioInput: {
      container: 'wav',
      encoding: 'pcm16le',
      sampleRateHz: 16000,
      channels: 1,
    },
  },
  {
    id: 'tts-supertonic-3-int8-2026-05-11',
    providerId: 'local-sherpa',
    displayName: 'Supertonic 3 (int8, Turkish)',
    languages: ['tr'],
    role: 'text-to-speech',
    distribution: 'managed',
    state: { status: 'not-installed' },
    downloadBytes: null,
    installedBytes: null,
    audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 },
    profileIds: [
      'supertonic-speaker-0',
      'supertonic-speaker-1',
      'supertonic-speaker-2',
      'supertonic-speaker-3',
      'supertonic-speaker-4',
      'supertonic-speaker-5',
      'supertonic-speaker-6',
      'supertonic-speaker-7',
      'supertonic-speaker-8',
      'supertonic-speaker-9',
    ],
  },
  {
    id: 'stt-phrase-v1',
    providerId: 'transcript-wake-word',
    displayName: 'Transcript Wake Word Phrase Matcher',
    languages: ['tr', 'en'],
    role: 'wake-word',
    distribution: 'built-in',
    state: { status: 'unmanaged' },
    phraseModel: true,
  },
];

export type ManagedCatalogEntry = {
  modelId: string;
  url: string;
  sha256: string | null;
  archiveBytes: number;
  expectedFiles: string[];
};

export const MANAGED_CATALOG_ENTRIES: Record<string, ManagedCatalogEntry> = {
  'stt-whisper-tiny-int8-v1': {
    modelId: 'stt-whisper-tiny-int8-v1',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2',
    sha256: null,
    archiveBytes: 116204861,
    expectedFiles: [
      'sherpa-onnx-whisper-tiny/tiny-encoder.int8.onnx',
      'sherpa-onnx-whisper-tiny/tiny-decoder.int8.onnx',
      'sherpa-onnx-whisper-tiny/tiny-tokens.txt',
    ],
  },
  'tts-supertonic-3-int8-2026-05-11': {
    modelId: 'tts-supertonic-3-int8-2026-05-11',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2',
    sha256: '82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427',
    archiveBytes: 128774318,
    expectedFiles: [
      'sherpa-onnx-supertonic-3-tts-int8-2026-05-11/duration_predictor.int8.onnx',
      'sherpa-onnx-supertonic-3-tts-int8-2026-05-11/text_encoder.int8.onnx',
      'sherpa-onnx-supertonic-3-tts-int8-2026-05-11/vector_estimator.int8.onnx',
      'sherpa-onnx-supertonic-3-tts-int8-2026-05-11/vocoder.int8.onnx',
      'sherpa-onnx-supertonic-3-tts-int8-2026-05-11/tts.json',
      'sherpa-onnx-supertonic-3-tts-int8-2026-05-11/unicode_indexer.bin',
      'sherpa-onnx-supertonic-3-tts-int8-2026-05-11/voice.bin',
    ],
  },
};

export class VoiceModelCatalog {
  public static getModels(): readonly VoiceModel[] {
    return FOOL_VOICE_MODELS;
  }

  public static getManagedEntry(modelId: string): ManagedCatalogEntry | undefined {
    return MANAGED_CATALOG_ENTRIES[modelId];
  }
}
