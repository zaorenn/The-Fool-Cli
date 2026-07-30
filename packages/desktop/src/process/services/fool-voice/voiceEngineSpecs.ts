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
  | (Common & { kind: 'zipvoice'; encoder: string; decoder: string; vocoder: string });

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
  'stt-whisper-tiny-int8-v1': {
    role: 'speech-to-text',
    engine: {
      kind: 'whisper',
      dir: 'sherpa-onnx-whisper-tiny.en',
      encoder: 'tiny-encoder.int8.onnx',
      decoder: 'tiny-decoder.int8.onnx',
      tokens: 'tiny-tokens.txt',
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
  'tts-zipvoice-distill-int8': {
    role: 'text-to-speech',
    engine: {
      kind: 'zipvoice',
      dir: 'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia',
      encoder: 'encoder.int8.onnx',
      decoder: 'decoder.int8.onnx',
      vocoder: 'vocoder.int8.onnx',
    },
  },
};

export const getEngineSpec = (modelId: string): VoiceEngineSpec | undefined => VOICE_ENGINE_SPECS[modelId];
