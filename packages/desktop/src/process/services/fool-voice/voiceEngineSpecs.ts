/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Declarative recipes for building a sherpa-onnx config from an installed model
 * directory.
 *
 * Adding a voice engine is a data change here plus a catalog row — never an
 * `if/else` branch in the provider. `dir` is the folder name inside the
 * archive, so it matches what {@link VoiceModelManager} extracted.
 */

/** Compute backend. `cuda` requires the GPU-enabled native libraries. */
export type VoiceCompute = 'cpu' | 'cuda';

type Common = { dir: string };

export type TtsEngineSpec =
  | (Common & { kind: 'vits'; model: string })
  | (Common & { kind: 'kokoro'; model: string; voices: string })
  | (Common & { kind: 'kitten'; model: string; voices: string })
  | (Common & { kind: 'matcha'; acousticModel: string; vocoder: string })
  /**
   * ZipVoice needs a vocoder, and its archive does not contain one.
   *
   * `sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2` ships the encoder,
   * the decoder, the tokens and a pronunciation lexicon; the vocoder is a
   * separate release asset (`vocoder-models/vocos_24khz.onnx`). Verified by
   * loading the engine: without it, `Please provide --zipvoice-vocoder`.
   */
  | (Common & { kind: 'zipvoice'; encoder: string; decoder: string; vocoder: string; lexicon: string })
  /**
   * Pocket clones from the recording alone — no transcript.
   *
   * ZipVoice aligns the new text against what the reference clip says, so a
   * wrong transcript is heard as the voice mispronouncing itself. Pocket builds
   * a speaker embedding from the audio instead, and caches it, so the reference
   * is paid for once per voice rather than once per sentence.
   */
  | (Common & {
      kind: 'pocket';
      lmFlow: string;
      lmMain: string;
      encoder: string;
      decoder: string;
      textConditioner: string;
      vocabJson: string;
      tokenScoresJson: string;
    });

export type SttEngineSpec =
  | (Common & { kind: 'whisper'; encoder: string; decoder: string; tokens: string })
  | (Common & {
      kind: 'transducer';
      encoder: string;
      decoder: string;
      joiner: string;
      tokens: string;
      modelType?: string;
    });

/**
 * Worker threads per role, measured on this project.
 *
 * Transcription is a large encoder pass and scales well: raising this from 4 to
 * 8 halved Whisper turbo latency (2343 ms -> 1150 ms for 5 s of audio).
 * Synthesis is already far faster than real time, so it stays modest and leaves
 * cores for the agent's own model.
 */
export const ENGINE_THREADS: Record<'speech-to-text' | 'text-to-speech', number> = {
  'speech-to-text': 8,
  'text-to-speech': 2,
};

/**
 * Threads for one text-to-speech engine, which is not one number.
 *
 * The two above were written when every voice was a small one. Piper renders a
 * sentence in 82 ms and gains nothing from more cores; the cloning engine runs
 * an encoder, a flow-matching decoder and a vocoder over the same sentence and
 * is the one voice a user ever waits for. Giving them the same two threads
 * throttled the slow one to keep the fast one modest.
 *
 * Half the machine, capped: past six threads ONNX spends more time synchronising
 * than computing at this model size, and the agent's own model needs cores too.
 */
const CLONING_THREAD_CAP = 6;

/** Engines that speak in a voice they were not trained on, and pay for it. */
const CLONING_KINDS: ReadonlySet<TtsEngineSpec['kind']> = new Set(['zipvoice', 'pocket']);

export const ttsThreadsFor = (kind: TtsEngineSpec['kind'], cpuCount: number): number => {
  if (!CLONING_KINDS.has(kind)) return ENGINE_THREADS['text-to-speech'];

  const usable = Number.isFinite(cpuCount) && cpuCount > 0 ? Math.floor(cpuCount / 2) : 0;
  return Math.max(ENGINE_THREADS['text-to-speech'], Math.min(CLONING_THREAD_CAP, usable));
};

export type VoiceEngineSpec =
  | { role: 'text-to-speech'; engine: TtsEngineSpec }
  | { role: 'speech-to-text'; engine: SttEngineSpec };

/**
 * Whether a model's weights can actually benefit from the GPU.
 *
 * Measured on this project: int8-quantised graphs are *slower* on the CUDA
 * execution provider than on CPU, because the quantised operators fall back to
 * CPU and pay a transfer cost on top. Only float graphs are offered a GPU path.
 */
export const canUseGpu = (modelId: string): boolean => !modelId.includes('int8');

export const VOICE_ENGINE_SPECS: Record<string, VoiceEngineSpec> = {
  // ---- Speech to text -----------------------------------------------------
  // Multilingual and code-switching capable: verified to auto-detect Turkish
  // and still surface embedded English terms ("pull request", "commit").
  'stt-whisper-turbo': {
    role: 'speech-to-text',
    engine: {
      kind: 'whisper',
      dir: 'sherpa-onnx-whisper-turbo',
      encoder: 'turbo-encoder.int8.onnx',
      decoder: 'turbo-decoder.int8.onnx',
      tokens: 'turbo-tokens.txt',
    },
  },
  // Names match the archive: `tiny.en-…`, after the model, not a bare `tiny-…`.
  'stt-whisper-tiny-int8-v1': {
    role: 'speech-to-text',
    engine: {
      kind: 'whisper',
      dir: 'sherpa-onnx-whisper-tiny.en',
      encoder: 'tiny.en-encoder.int8.onnx',
      decoder: 'tiny.en-decoder.int8.onnx',
      tokens: 'tiny.en-tokens.txt',
    },
  },

  // ---- Text to speech ----------------------------------------------------
  'tts-piper-en-libritts-r': {
    role: 'text-to-speech',
    engine: {
      kind: 'vits',
      dir: 'vits-piper-en_US-libritts_r-medium',
      model: 'en_US-libritts_r-medium.onnx',
    },
  },
  'tts-piper-tr-fettah': {
    role: 'text-to-speech',
    engine: {
      kind: 'vits',
      dir: 'vits-piper-tr_TR-fettah-medium',
      model: 'tr_TR-fettah-medium.onnx',
    },
  },
  'tts-kitten-nano-en-v0_8': {
    role: 'text-to-speech',
    engine: {
      kind: 'kitten',
      dir: 'kitten-nano-en-v0_8-fp32',
      model: 'model.fp32.onnx',
      voices: 'voices.bin',
    },
  },
  'tts-kokoro-en-v0_19-int8': {
    role: 'text-to-speech',
    engine: {
      kind: 'kokoro',
      dir: 'kokoro-int8-en-v0_19',
      model: 'model.int8.onnx',
      voices: 'voices.bin',
    },
  },
  // File names taken from the upstream Node example for this exact archive.
  // Note the mixed precision: the encoder and the text conditioner ship as
  // float even in the int8 build, so neither can be renamed to match the others.
  'tts-pocket-int8-2026-01-26': {
    role: 'text-to-speech',
    engine: {
      kind: 'pocket',
      dir: 'sherpa-onnx-pocket-tts-int8-2026-01-26',
      lmFlow: 'lm_flow.int8.onnx',
      lmMain: 'lm_main.int8.onnx',
      encoder: 'encoder.onnx',
      decoder: 'decoder.int8.onnx',
      textConditioner: 'text_conditioner.onnx',
      vocabJson: 'vocab.json',
      tokenScoresJson: 'token_scores.json',
    },
  },
  'tts-zipvoice-distill-int8': {
    role: 'text-to-speech',
    engine: {
      kind: 'zipvoice',
      dir: 'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia',
      encoder: 'encoder.int8.onnx',
      decoder: 'decoder.int8.onnx',
      vocoder: 'vocos_24khz.onnx',
      lexicon: 'lexicon.txt',
    },
  },
};

export const getEngineSpec = (modelId: string): VoiceEngineSpec | undefined => VOICE_ENGINE_SPECS[modelId];
