import type { VoiceModel, VoiceProfile } from '../../../common/types/foolVoice';

const RELEASE_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';

/**
 * Kokoro v0.19 ships eleven named English voices, indexed by speaker id in the
 * order below. Verified against the released `voices.bin` (11 x 523264 bytes).
 */
const KOKORO_EN_VOICES: readonly { id: string; displayName: string }[] = [
  { id: 'af', displayName: 'Alloy (US, female)' },
  { id: 'af_bella', displayName: 'Bella (US, female)' },
  { id: 'af_nicole', displayName: 'Nicole (US, female)' },
  { id: 'af_sarah', displayName: 'Sarah (US, female)' },
  { id: 'af_sky', displayName: 'Sky (US, female)' },
  { id: 'am_adam', displayName: 'Adam (US, male)' },
  { id: 'am_michael', displayName: 'Michael (US, male)' },
  { id: 'bf_emma', displayName: 'Emma (UK, female)' },
  { id: 'bf_isabella', displayName: 'Isabella (UK, female)' },
  { id: 'bm_george', displayName: 'George (UK, male)' },
  { id: 'bm_lewis', displayName: 'Lewis (UK, male)' },
];

/**
 * LibriTTS-R carries 904 speakers, which is far too many to present as a
 * pickable list. These are a curated, evenly spread selection.
 */
const PIPER_LIBRITTS_VOICES: readonly { id: string; displayName: string; speakerId: number }[] = [
  { id: 'libritts-p0', displayName: 'Reader 1 (US)', speakerId: 0 },
  { id: 'libritts-p16', displayName: 'Reader 2 (US)', speakerId: 16 },
  { id: 'libritts-p64', displayName: 'Reader 3 (US)', speakerId: 64 },
  { id: 'libritts-p128', displayName: 'Reader 4 (US)', speakerId: 128 },
  { id: 'libritts-p256', displayName: 'Reader 5 (US)', speakerId: 256 },
  { id: 'libritts-p400', displayName: 'Reader 6 (US)', speakerId: 400 },
  { id: 'libritts-p600', displayName: 'Reader 7 (US)', speakerId: 600 },
  { id: 'libritts-p800', displayName: 'Reader 8 (US)', speakerId: 800 },
];

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
    id: 'tts-kokoro-en-v0_19-int8',
    providerId: 'local-sherpa',
    displayName: 'Kokoro (Natural English, int8)',
    languages: ['en'],
    role: 'text-to-speech',
    distribution: 'managed',
    state: { status: 'not-installed' },
    downloadBytes: null,
    installedBytes: null,
    audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 },
    profileIds: KOKORO_EN_VOICES.map((voice) => voice.id),
  },
  {
    id: 'tts-piper-en-libritts-r-int8',
    providerId: 'local-sherpa',
    displayName: 'Piper LibriTTS-R (English, int8)',
    languages: ['en'],
    role: 'text-to-speech',
    distribution: 'managed',
    state: { status: 'not-installed' },
    downloadBytes: null,
    installedBytes: null,
    audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 },
    profileIds: PIPER_LIBRITTS_VOICES.map((voice) => voice.id),
  },
  {
    id: 'tts-piper-tr-fettah-int8',
    providerId: 'local-sherpa',
    displayName: 'Piper Fettah (Turkish, int8)',
    languages: ['tr'],
    role: 'text-to-speech',
    distribution: 'managed',
    state: { status: 'not-installed' },
    downloadBytes: null,
    installedBytes: null,
    audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 },
    profileIds: ['piper-tr-fettah'],
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
    id: 'tts-zipvoice-distill-int8',
    providerId: 'local-sherpa',
    displayName: 'ZipVoice (Voice cloning, int8)',
    languages: ['en', 'zh'],
    role: 'text-to-speech',
    distribution: 'managed',
    state: { status: 'not-installed' },
    downloadBytes: null,
    installedBytes: null,
    audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 },
    profileIds: [],
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

/**
 * Preset voices exposed as a pickable list.
 *
 * `speakerId` is the value passed to the synthesiser; the ids are stable so a
 * stored preference survives catalog reordering.
 */
export const FOOL_VOICE_PRESET_PROFILES: readonly VoiceProfile[] = [
  ...KOKORO_EN_VOICES.map(
    (voice, index): VoiceProfile => ({
      id: voice.id,
      providerId: 'local-sherpa',
      modelId: 'tts-kokoro-en-v0_19-int8',
      kind: 'preset',
      state: 'unavailable',
      displayName: voice.displayName,
      languages: ['en'],
      speakerId: index,
      deletable: false,
    })
  ),
  ...PIPER_LIBRITTS_VOICES.map(
    (voice): VoiceProfile => ({
      id: voice.id,
      providerId: 'local-sherpa',
      modelId: 'tts-piper-en-libritts-r-int8',
      kind: 'preset',
      state: 'unavailable',
      displayName: voice.displayName,
      languages: ['en'],
      speakerId: voice.speakerId,
      deletable: false,
    })
  ),
  {
    id: 'piper-tr-fettah',
    providerId: 'local-sherpa',
    modelId: 'tts-piper-tr-fettah-int8',
    kind: 'preset',
    state: 'unavailable',
    displayName: 'Fettah (Türkçe)',
    languages: ['tr'],
    speakerId: 0,
    deletable: false,
  },
  ...Array.from(
    { length: 10 },
    (_, index): VoiceProfile => ({
      id: `supertonic-speaker-${index}`,
      providerId: 'local-sherpa',
      modelId: 'tts-supertonic-3-int8-2026-05-11',
      kind: 'preset',
      state: 'unavailable',
      displayName: `Supertonic ${index + 1} (Türkçe)`,
      languages: ['tr'],
      speakerId: index,
      deletable: false,
    })
  ),
];

export type ManagedCatalogEntry = {
  modelId: string;
  url: string;
  sha256: string | null;
  archiveBytes: number;
  expectedFiles: string[];
};

/**
 * Checksums and byte sizes below were measured from the downloaded archives,
 * not copied from documentation.
 */
export const MANAGED_CATALOG_ENTRIES: Record<string, ManagedCatalogEntry> = {
  'stt-whisper-tiny-int8-v1': {
    modelId: 'stt-whisper-tiny-int8-v1',
    url: `${RELEASE_BASE}/asr-models/sherpa-onnx-whisper-tiny.tar.bz2`,
    sha256: null,
    archiveBytes: 116204861,
    expectedFiles: [
      'sherpa-onnx-whisper-tiny/tiny-encoder.int8.onnx',
      'sherpa-onnx-whisper-tiny/tiny-decoder.int8.onnx',
      'sherpa-onnx-whisper-tiny/tiny-tokens.txt',
    ],
  },
  'tts-kokoro-en-v0_19-int8': {
    modelId: 'tts-kokoro-en-v0_19-int8',
    url: `${RELEASE_BASE}/tts-models/kokoro-int8-en-v0_19.tar.bz2`,
    sha256: 'c9f0dd393615805b0bab050c340834d5e684e732aec91c0e860cd30e982c08bd',
    archiveBytes: 103248205,
    expectedFiles: [
      'kokoro-int8-en-v0_19/model.int8.onnx',
      'kokoro-int8-en-v0_19/voices.bin',
      'kokoro-int8-en-v0_19/tokens.txt',
    ],
  },
  'tts-piper-en-libritts-r-int8': {
    modelId: 'tts-piper-en-libritts-r-int8',
    url: `${RELEASE_BASE}/tts-models/vits-piper-en_US-libritts_r-medium-int8.tar.bz2`,
    sha256: '7e4552e239988f4896872822b56e99e0e9e00958164e3f6bdf5ee14391fbe829',
    archiveBytes: 23398348,
    expectedFiles: [
      'vits-piper-en_US-libritts_r-medium-int8/en_US-libritts_r-medium.onnx',
      'vits-piper-en_US-libritts_r-medium-int8/tokens.txt',
    ],
  },
  'tts-piper-tr-fettah-int8': {
    modelId: 'tts-piper-tr-fettah-int8',
    url: `${RELEASE_BASE}/tts-models/vits-piper-tr_TR-fettah-medium-int8.tar.bz2`,
    sha256: '4374bfdabb88ada0f3edf9bd46eacf1c5391a8a93bdce364196495891e5bc323',
    archiveBytes: 21186168,
    expectedFiles: [
      'vits-piper-tr_TR-fettah-medium-int8/tr_TR-fettah-medium.onnx',
      'vits-piper-tr_TR-fettah-medium-int8/tokens.txt',
    ],
  },
  'tts-supertonic-3-int8-2026-05-11': {
    modelId: 'tts-supertonic-3-int8-2026-05-11',
    url: `${RELEASE_BASE}/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2`,
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
  'tts-zipvoice-distill-int8': {
    modelId: 'tts-zipvoice-distill-int8',
    url: `${RELEASE_BASE}/tts-models/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2`,
    sha256: '77219c8b40f4ee8d73a7f902305ff6c1128ef9b54461c41b4ca6ed890b6c2803',
    archiveBytes: 109162785,
    expectedFiles: [
      'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia/encoder.int8.onnx',
      'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia/decoder.int8.onnx',
      'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia/tokens.txt',
    ],
  },
};

export class VoiceModelCatalog {
  public static getModels(): readonly VoiceModel[] {
    return FOOL_VOICE_MODELS;
  }

  public static getPresetProfiles(): readonly VoiceProfile[] {
    return FOOL_VOICE_PRESET_PROFILES;
  }

  public static getManagedEntry(modelId: string): ManagedCatalogEntry | undefined {
    return MANAGED_CATALOG_ENTRIES[modelId];
  }
}
