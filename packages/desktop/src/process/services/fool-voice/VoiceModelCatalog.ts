import {
  AUDIOCPP_CHATTERBOX_MODEL_ID,
  AUDIOCPP_INDEXTTS2_MODEL_ID,
  AUDIOCPP_MOSS_NANO_MODEL_ID,
  AUDIOCPP_POCKET_MODEL_ID,
  type VoiceModel,
  type VoiceProfile,
} from '../../../common/types/foolVoice';
import { AUDIOCPP_MODEL_SPECS, getAudioCppModelSpec } from './audiocpp/audioCppEngineSpecs';

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
    id: 'stt-whisper-turbo',
    providerId: 'local-sherpa',
    displayName: 'Whisper Turbo (Turkish + English)',
    languages: ['tr', 'en'],
    role: 'speech-to-text',
    distribution: 'managed',
    state: { status: 'not-installed' },
    downloadBytes: null,
    installedBytes: null,
    audioInput: { container: 'wav', encoding: 'pcm16le', sampleRateHz: 16000, channels: 1 },
  },
  {
    id: 'tts-piper-en-libritts-r',
    providerId: 'local-sherpa',
    displayName: 'Piper LibriTTS-R (English, fastest)',
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
    id: 'tts-piper-tr-fettah',
    providerId: 'local-sherpa',
    displayName: 'Piper Fettah (Türkçe)',
    languages: ['tr'],
    role: 'text-to-speech',
    distribution: 'managed',
    state: { status: 'not-installed' },
    downloadBytes: null,
    installedBytes: null,
    audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 },
    profileIds: ['piper-tr-fettah-v2'],
  },
  {
    id: 'tts-kitten-nano-en-v0_8',
    providerId: 'local-sherpa',
    displayName: 'Kitten Nano (English)',
    languages: ['en'],
    role: 'text-to-speech',
    distribution: 'managed',
    state: { status: 'not-installed' },
    downloadBytes: null,
    installedBytes: null,
    audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 },
    profileIds: ['kitten-nano-0', 'kitten-nano-1', 'kitten-nano-2', 'kitten-nano-3'],
  },
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
  // The int8 Piper builds were removed after measurement: they synthesise 4x
  // slower than the float builds above (300 ms vs 82 ms) because quantisation
  // overhead dominates at this model size.
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
    id: 'tts-pocket-int8-2026-01-26',
    providerId: 'local-sherpa',
    displayName: 'Pocket (Voice cloning, fastest)',
    languages: ['en'],
    role: 'text-to-speech',
    distribution: 'managed',
    state: { status: 'not-installed' },
    downloadBytes: null,
    installedBytes: null,
    audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 },
    profileIds: [],
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
    id: AUDIOCPP_POCKET_MODEL_ID,
    providerId: 'local-audiocpp',
    // Named for what separates it from the sherpa entry above, which is the
    // only reason both exist: same weights, same voice, but this one can be
    // tuned.
    displayName: 'Pocket (Voice cloning, fastest — with parameters)',
    languages: getAudioCppModelSpec(AUDIOCPP_POCKET_MODEL_ID)?.languages ?? ['en'],
    role: 'text-to-speech',
    distribution: 'managed',
    state: { status: 'not-installed' },
    downloadBytes: null,
    installedBytes: null,
    audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 },
    profileIds: [],
    requiresClonedVoice: true,
    paramSpecs: getAudioCppModelSpec(AUDIOCPP_POCKET_MODEL_ID)?.params,
  },
  {
    id: AUDIOCPP_MOSS_NANO_MODEL_ID,
    providerId: 'local-audiocpp',
    displayName: 'MOSS-TTS-Nano (Voice cloning, fast, 19 languages)',
    languages: getAudioCppModelSpec(AUDIOCPP_MOSS_NANO_MODEL_ID)?.languages ?? ['en'],
    role: 'text-to-speech',
    distribution: 'managed',
    state: { status: 'not-installed' },
    downloadBytes: null,
    installedBytes: null,
    audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 },
    profileIds: [],
    requiresClonedVoice: true,
    paramSpecs: getAudioCppModelSpec(AUDIOCPP_MOSS_NANO_MODEL_ID)?.params,
  },
  {
    id: AUDIOCPP_CHATTERBOX_MODEL_ID,
    providerId: 'local-audiocpp',
    // Named for what it speaks, not for the one language worth pointing out.
    // "Türkçe" alone read as "Turkish only" — English is its first language and
    // the one its defaults were tuned on.
    displayName: 'Chatterbox (Voice cloning, expressive — English, Türkçe + 10 more)',
    languages: getAudioCppModelSpec(AUDIOCPP_CHATTERBOX_MODEL_ID)?.languages ?? ['en'],
    role: 'text-to-speech',
    distribution: 'managed',
    state: { status: 'not-installed' },
    downloadBytes: null,
    installedBytes: null,
    audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 },
    // No presets, and no way to acquire one: this engine's loader accepts only
    // cloning and voice-conversion sessions, so it can *only* ever speak in a
    // voice the user cloned.
    profileIds: [],
    requiresClonedVoice: true,
    paramSpecs: getAudioCppModelSpec(AUDIOCPP_CHATTERBOX_MODEL_ID)?.params,
  },
  {
    id: AUDIOCPP_INDEXTTS2_MODEL_ID,
    providerId: 'local-audiocpp',
    displayName: 'IndexTTS2 (Voice cloning, emotion control)',
    languages: getAudioCppModelSpec(AUDIOCPP_INDEXTTS2_MODEL_ID)?.languages ?? ['en'],
    role: 'text-to-speech',
    distribution: 'managed',
    state: { status: 'not-installed' },
    downloadBytes: null,
    installedBytes: null,
    audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 },
    // Its loader does advertise a plain-TTS task, but the request parser throws
    // without speaker audio, so in practice this is a cloning engine too.
    profileIds: [],
    requiresClonedVoice: true,
    paramSpecs: getAudioCppModelSpec(AUDIOCPP_INDEXTTS2_MODEL_ID)?.params,
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
  ...PIPER_LIBRITTS_VOICES.map(
    (voice): VoiceProfile => ({
      id: voice.id,
      providerId: 'local-sherpa',
      modelId: 'tts-piper-en-libritts-r',
      kind: 'preset',
      state: 'unavailable',
      displayName: voice.displayName,
      languages: ['en'],
      speakerId: voice.speakerId,
      deletable: false,
    })
  ),
  {
    id: 'piper-tr-fettah-v2',
    providerId: 'local-sherpa',
    modelId: 'tts-piper-tr-fettah',
    kind: 'preset',
    state: 'unavailable',
    displayName: 'Fettah (Türkçe)',
    languages: ['tr'],
    speakerId: 0,
    deletable: false,
  },
  ...Array.from(
    { length: 4 },
    (_, index): VoiceProfile => ({
      id: `kitten-nano-${index}`,
      providerId: 'local-sherpa',
      modelId: 'tts-kitten-nano-en-v0_8',
      kind: 'preset',
      state: 'unavailable',
      displayName: `Kitten ${index + 1} (English)`,
      languages: ['en'],
      speakerId: index,
      deletable: false,
    })
  ),
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

/**
 * A file the model needs that its archive does not contain.
 *
 * ZipVoice is the case this exists for: the engine refuses to open without a
 * vocoder, and the vocoder is published as its own release asset rather than
 * inside the model archive.
 */
export type ManagedExtraFile = {
  url: string;
  sha256: string;
  bytes: number;
  /** Where it lands, relative to the model directory. */
  destination: string;
};

export type ManagedCatalogEntry = {
  modelId: string;
  url: string;
  sha256: string | null;
  archiveBytes: number;
  expectedFiles: string[];
  extraFiles?: ManagedExtraFile[];
};

/**
 * Checksums and byte sizes below were measured from the downloaded archives,
 * not copied from documentation.
 */
export const MANAGED_CATALOG_ENTRIES: Record<string, ManagedCatalogEntry> = {
  // Multilingual transcription. Measured on this machine: 1150 ms for 5 s of
  // audio at 8 threads (4.3x realtime), auto-detects Turkish and keeps embedded
  // English terms.
  'stt-whisper-turbo': {
    modelId: 'stt-whisper-turbo',
    url: `${RELEASE_BASE}/asr-models/sherpa-onnx-whisper-turbo.tar.bz2`,
    sha256: 'b11acbbcd660b44a8e0df33724feb5aaa709cf65668f2823d59f656312544f22',
    archiveBytes: 563790207,
    expectedFiles: [
      'sherpa-onnx-whisper-turbo/turbo-encoder.int8.onnx',
      'sherpa-onnx-whisper-turbo/turbo-decoder.int8.onnx',
      'sherpa-onnx-whisper-turbo/turbo-tokens.txt',
    ],
  },
  // Fastest measured voice: 82 ms for a short sentence (29.6x realtime).
  // float weights beat the int8 build here — quantisation overhead dominates at
  // this model size.
  'tts-piper-en-libritts-r': {
    modelId: 'tts-piper-en-libritts-r',
    url: `${RELEASE_BASE}/tts-models/vits-piper-en_US-libritts_r-medium.tar.bz2`,
    sha256: '10dc268f3e371696d721486123e2705a9fc1faa113491979fde4d88dba1f1b1c',
    archiveBytes: 82038311,
    expectedFiles: [
      'vits-piper-en_US-libritts_r-medium/en_US-libritts_r-medium.onnx',
      'vits-piper-en_US-libritts_r-medium/tokens.txt',
    ],
  },
  // Turkish voice: 214 ms for 5 s of speech (23.2x realtime).
  'tts-piper-tr-fettah': {
    modelId: 'tts-piper-tr-fettah',
    url: `${RELEASE_BASE}/tts-models/vits-piper-tr_TR-fettah-medium.tar.bz2`,
    sha256: '314a9910616fb17be882c77f0bcf76796a1914d4d606f3c984f9094cb9abf1e5',
    archiveBytes: 67174342,
    expectedFiles: [
      'vits-piper-tr_TR-fettah-medium/tr_TR-fettah-medium.onnx',
      'vits-piper-tr_TR-fettah-medium/tokens.txt',
    ],
  },
  // Alternative English voice: 241 ms (12.3x realtime).
  'tts-kitten-nano-en-v0_8': {
    modelId: 'tts-kitten-nano-en-v0_8',
    url: `${RELEASE_BASE}/tts-models/kitten-nano-en-v0_8-fp32.tar.bz2`,
    sha256: '16092117bfe591ddcd58d078e1454603b8e1caea46f85653b2c2efae76bd883e',
    archiveBytes: 63815222,
    expectedFiles: [
      'kitten-nano-en-v0_8-fp32/model.fp32.onnx',
      'kitten-nano-en-v0_8-fp32/voices.bin',
      'kitten-nano-en-v0_8-fp32/tokens.txt',
    ],
  },
  // File names verified against the extracted archive: this build prefixes them
  // with the model name, `tiny.en`, not a bare `tiny`. The wrong names made the
  // download fail its manifest check and an already-extracted copy read as
  // not-installed.
  'stt-whisper-tiny-int8-v1': {
    modelId: 'stt-whisper-tiny-int8-v1',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.en.tar.bz2',
    sha256: null,
    archiveBytes: 116204861,
    expectedFiles: [
      'sherpa-onnx-whisper-tiny.en/tiny.en-encoder.int8.onnx',
      'sherpa-onnx-whisper-tiny.en/tiny.en-decoder.int8.onnx',
      'sherpa-onnx-whisper-tiny.en/tiny.en-tokens.txt',
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
  // Cloning without a transcript, and with the speaker embedding cached between
  // requests rather than derived from the recording every time. `archiveBytes`
  // is the size the release reports for this asset; the checksum is left unset
  // because it has not been measured from a download on this project yet, which
  // is the same footing the Whisper tiny entry above is on.
  'tts-pocket-int8-2026-01-26': {
    modelId: 'tts-pocket-int8-2026-01-26',
    url: `${RELEASE_BASE}/tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2`,
    sha256: null,
    archiveBytes: 98336520,
    expectedFiles: [
      'sherpa-onnx-pocket-tts-int8-2026-01-26/lm_flow.int8.onnx',
      'sherpa-onnx-pocket-tts-int8-2026-01-26/lm_main.int8.onnx',
      // Float even in the int8 build; these two are not quantised upstream.
      'sherpa-onnx-pocket-tts-int8-2026-01-26/encoder.onnx',
      'sherpa-onnx-pocket-tts-int8-2026-01-26/decoder.int8.onnx',
      'sherpa-onnx-pocket-tts-int8-2026-01-26/text_conditioner.onnx',
      'sherpa-onnx-pocket-tts-int8-2026-01-26/vocab.json',
      'sherpa-onnx-pocket-tts-int8-2026-01-26/token_scores.json',
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
      'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia/lexicon.txt',
      'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia/tokens.txt',
    ],
    // The engine refuses to open without a vocoder and the archive has none, so
    // it is fetched alongside. Checksum and size measured from the download.
    extraFiles: [
      {
        url: `${RELEASE_BASE}/vocoder-models/vocos_24khz.onnx`,
        sha256: 'bcb3b970e384161c4d634f0bb9e999ff1c471b34c9bc0b1049a5014065ed3cc0',
        bytes: 54157409,
        destination: 'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia/vocos_24khz.onnx',
      },
    ],
  },
};

/**
 * The prebuilt audio.cpp package that runs the GGUF voices.
 *
 * Downloaded on first install of any audio.cpp model rather than bundled into
 * the installer: it keeps the installer small and the clean-machine install path
 * unchanged, and it is how voice models already work here.
 *
 * Version-pinned down to the asset name, because the name carries a commit hash
 * (`-3178daf4`) that changes independently of the tag — a pin on the tag alone
 * would not resolve to a file.
 */
export type EngineCatalogEntry = {
  engineId: string;
  /** Release tag, used only as the on-disk directory name. */
  version: string;
  url: string;
  sha256: string | null;
  archiveBytes: number;
  /** Paths inside the zip, which stores its files at the archive root. */
  expectedFiles: string[];
  /** The executable to spawn, relative to the extracted directory. */
  binaryPath: string;
};

/**
 * The Windows CPU package, `balance` profile.
 *
 * Upstream builds three CPU variants and its own packaging script documents what
 * separates them: `fast` compiles with `-CpuArch native` and may bake in AVX-512,
 * which upstream itself calls "not the safest choice for broad public
 * distribution"; `portable` drops to a baseline arch with llamafile SGEMM off,
 * the slowest but most compatible; `balance` targets AVX2 and is upstream's
 * "recommended default for most modern Windows PCs". This app ships to whatever
 * machine the user has, so `balance` it is.
 *
 * `sha256` is unset because no download has been made on this project to measure
 * it from — the same footing the Whisper tiny and Pocket entries are on. The
 * manifest check after extraction is what proves the archive was the right one.
 */
export const AUDIOCPP_ENGINE: EngineCatalogEntry = {
  engineId: 'audiocpp',
  version: 'release-0.5',
  url: 'https://github.com/0xShug0/audio.cpp/releases/download/release-0.5/audiocpp-windows-cpu-balance-3178daf4.zip',
  sha256: null,
  archiveBytes: 11399800,
  // Flat, not under `bin/`: upstream's packaging script stages the build's `bin`
  // directory plus the MSVC and OpenMP redistributables, then archives the
  // staging directory's *contents*.
  expectedFiles: ['audiocpp_server.exe', 'MSVCP140.dll', 'VCRUNTIME140.dll'],
  binaryPath: 'audiocpp_server.exe',
};

/**
 * A model whose weights arrive as plain files rather than inside an archive.
 *
 * The GGUF builds are single files on Hugging Face, and a GGUF carries its own
 * model spec and auxiliary assets as embedded metadata — which is why upstream's
 * own package manifest for `chatterbox_q8_0` lists exactly one file, and why the
 * folder it comes from contains nothing else.
 */
export type AudioCppFile = {
  url: string;
  /** Null when no checksum has been measured from a real download here. */
  sha256: string | null;
  bytes: number;
  /** Where it lands, relative to the model directory. */
  destination: string;
};

export type AudioCppCatalogEntry = {
  modelId: string;
  engineId: string;
  files: AudioCppFile[];
  /** Paths that must exist under the model directory once installed. */
  expectedFiles: string[];
  /** Total transfer size, for the progress bar. */
  archiveBytes: number;
};

const HUGGINGFACE_GGUF = 'https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/main';

/**
 * Sizes are what the Hugging Face API reports for the LFS objects, not
 * guesses — both are multi-gigabyte, so a progress bar that lies about the
 * total is worse here than anywhere else in this catalog.
 */
export const AUDIOCPP_CATALOG_ENTRIES: Record<string, AudioCppCatalogEntry> = {
  // Two orders of magnitude smaller than the pair below them, which is the
  // whole point: Chatterbox takes tens of seconds a sentence on a CPU and these
  // take one or two. Sizes are the LFS objects' own, read from the API.
  [AUDIOCPP_POCKET_MODEL_ID]: {
    modelId: AUDIOCPP_POCKET_MODEL_ID,
    engineId: AUDIOCPP_ENGINE.engineId,
    files: [
      {
        url: `${HUGGINGFACE_GGUF}/PocketTTS-GGUF/english/pocket-tts-english-q8_0.gguf`,
        sha256: null,
        bytes: 127856704,
        destination: 'pocket-tts-english-q8_0.gguf',
      },
    ],
    // The 26 preset speaker embeddings that sit beside these weights are not
    // fetched: this entry exists to render cloned voices, and they would add
    // roughly 150 MB of voices the picker already has better ones for.
    expectedFiles: ['pocket-tts-english-q8_0.gguf'],
    archiveBytes: 127856704,
  },
  [AUDIOCPP_MOSS_NANO_MODEL_ID]: {
    modelId: AUDIOCPP_MOSS_NANO_MODEL_ID,
    engineId: AUDIOCPP_ENGINE.engineId,
    files: [
      {
        url: `${HUGGINGFACE_GGUF}/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-q8_0.gguf`,
        sha256: null,
        bytes: 193337984,
        destination: 'moss-tts-nano-100m-q8_0.gguf',
      },
    ],
    expectedFiles: ['moss-tts-nano-100m-q8_0.gguf'],
    archiveBytes: 193337984,
  },
  [AUDIOCPP_CHATTERBOX_MODEL_ID]: {
    modelId: AUDIOCPP_CHATTERBOX_MODEL_ID,
    engineId: AUDIOCPP_ENGINE.engineId,
    files: [
      {
        url: `${HUGGINGFACE_GGUF}/Chatterbox-GGUF/chatterbox-q8_0.gguf`,
        sha256: null,
        bytes: 2088393668,
        destination: 'chatterbox-q8_0.gguf',
      },
    ],
    expectedFiles: ['chatterbox-q8_0.gguf'],
    archiveBytes: 2088393668,
  },
  [AUDIOCPP_INDEXTTS2_MODEL_ID]: {
    modelId: AUDIOCPP_INDEXTTS2_MODEL_ID,
    engineId: AUDIOCPP_ENGINE.engineId,
    files: [
      {
        url: `${HUGGINGFACE_GGUF}/IndexTTS2-GGUF/index-tts2-q8_0.gguf`,
        sha256: null,
        bytes: 3633888608,
        destination: 'index-tts2-q8_0.gguf',
      },
    ],
    expectedFiles: ['index-tts2-q8_0.gguf'],
    archiveBytes: 3633888608,
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

  public static getAudioCppEntry(modelId: string): AudioCppCatalogEntry | undefined {
    return AUDIOCPP_CATALOG_ENTRIES[modelId];
  }

  public static getEngine(engineId: string): EngineCatalogEntry | undefined {
    return engineId === AUDIOCPP_ENGINE.engineId ? AUDIOCPP_ENGINE : undefined;
  }

  /** Every audio.cpp model, as the runtime's server config needs to see them. */
  public static getAudioCppModelSpecs(): typeof AUDIOCPP_MODEL_SPECS {
    return AUDIOCPP_MODEL_SPECS;
  }
}
