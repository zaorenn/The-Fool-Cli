/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AUDIOCPP_CHATTERBOX_MODEL_ID,
  AUDIOCPP_INDEXTTS2_MODEL_ID,
  type VoiceParams,
  type VoiceParamSpec,
  type VoiceParamValue,
} from '../../../../common/types/foolVoice';

/**
 * Declarative per-model knowledge for the audio.cpp engine.
 *
 * Mirrors what `voiceEngineSpecs.ts` does for sherpa: adding a model is a data
 * change here plus a catalog row, never a branch in the provider. This file is
 * the single source of truth for both the IPC validator and the settings UI, so
 * a parameter that is not declared here cannot be sent and cannot be shown.
 *
 * Every parameter name is the **snake_case HTTP spelling**. The hyphenated
 * forms in upstream's docs are CLI `argv` flags that the CLI itself translates;
 * sent over HTTP they land under a key no model reads, and synthesis quietly
 * returns default-parameter audio. Names and defaults below were read from the
 * model sources, not from upstream's prose, which disagrees with its own code —
 * see `docs/superpowers/specs/2026-08-01-audiocpp-http-contract.md` §4.
 */

export type AudioCppModelSpec = {
  /** This app's catalog id. */
  modelId: string;
  /**
   * The id the running server addresses this model by.
   *
   * Ours to choose — upstream matches it against the `id` of a config entry, not
   * against the family name — so it is kept short and stable.
   */
  serverModelId: string;
  /** Upstream family name, as `model_specs/<family>.json` declares it. */
  family: string;
  /**
   * Framework task spelling for the config entry.
   *
   * `clon` for cloning. Note that `clone`, with an `e`, is not a spelling the
   * parser knows — it appears only in the family spec's UI metadata.
   */
  task: 'tts' | 'clon' | 'vc';
  /** Neither model streams; sentence chunking stays the app's job. */
  mode: 'offline';
  /** The GGUF file the weights arrive as, relative to the model directory. */
  weightsFile: string;
  languages: readonly string[];
  /**
   * Whether the engine refuses to speak without a reference clip.
   *
   * True for both models shipped here, for different reasons that land in the
   * same place: Chatterbox's loader accepts only cloning and voice-conversion
   * sessions, and IndexTTS2's request parser throws
   * `"IndexTTS2 request requires --voice-ref or voice.speaker.audio"` even
   * though its loader does advertise a plain-TTS task.
   */
  requiresVoiceReference: boolean;
  /** Whether the engine reads `reference_text`. Neither of these does. */
  usesReferenceText: boolean;
  params: readonly VoiceParamSpec[];
};

/**
 * Chatterbox.
 *
 * Defaults are the struct initialisers in `include/engine/models/chatterbox/tts.h`,
 * which are what actually applies when a key is omitted: neither the CLI nor the
 * family spec injects a default of its own. Three of them contradict upstream's
 * `docs/tts.md` — `top_p` 1.0 not 0.8, `repetition_penalty` 1.2 not 2.0,
 * `max_tokens` 384 not 1000 — and the code wins.
 *
 * Ranges are this app's, not upstream's: the engine declares none, so these are
 * chosen to keep a slider inside values that produce speech rather than noise.
 */
const CHATTERBOX_PARAMS: readonly VoiceParamSpec[] = [
  { name: 'guidance_scale', type: 'number', min: 0, max: 1, step: 0.05, default: 0.5 },
  { name: 'temperature', type: 'number', min: 0.05, max: 2, step: 0.05, default: 0.8 },
  { name: 'exaggeration', type: 'number', min: 0, max: 2, step: 0.05, default: 0.5 },
  { name: 'top_p', type: 'number', min: 0.05, max: 1, step: 0.05, default: 1 },
  { name: 'min_p', type: 'number', min: 0, max: 1, step: 0.01, default: 0.05 },
  { name: 'repetition_penalty', type: 'number', min: 1, max: 4, step: 0.05, default: 1.2 },
  { name: 's3gen_cfg_rate', type: 'number', min: 0, max: 1, step: 0.05, default: 0.7 },
  { name: 'max_tokens', type: 'number', min: 32, max: 2048, step: 1, integer: true, default: 384 },
  // Neither of these two has a flat top-level alias upstream, so they only ever
  // work nested inside `options` — which is where every parameter goes here.
  { name: 'do_sample', type: 'boolean', default: true },
  { name: 'text_chunk_size', type: 'number', min: 16, max: 512, step: 1, integer: true, default: 128 },
  { name: 'stop_on_eos', type: 'boolean', default: true },
];

/**
 * IndexTTS2.
 *
 * Defaults are `IndexTTS2GenerationOptions` and `IndexTTS2Request` in
 * `include/engine/models/index_tts2/types.h`. Four bounds are the engine's own
 * and are enforced here so a rejected value is reported as an invalid request
 * rather than as a 500 from the server: `top_p` in (0, 1], `top_k` > 0,
 * `temperature` > 0, `num_beams` > 0, `max_tokens` > 0, `emotion_alpha` in
 * [0, 1], `interval_silence_ms` >= 0.
 *
 * `emotion_vector` is deliberately absent: it is eight comma-separated floats
 * in one string, and the parser throws on anything that is not exactly eight.
 * Emotion is reachable here through `emotion_text` instead.
 */
const INDEXTTS2_PARAMS: readonly VoiceParamSpec[] = [
  { name: 'temperature', type: 'number', min: 0.05, max: 2, step: 0.05, default: 0.8 },
  { name: 'top_p', type: 'number', min: 0.05, max: 1, step: 0.05, default: 0.8 },
  { name: 'top_k', type: 'number', min: 1, max: 100, step: 1, integer: true, default: 30 },
  { name: 'repetition_penalty', type: 'number', min: 1, max: 20, step: 0.5, default: 10 },
  { name: 'length_penalty', type: 'number', min: -2, max: 2, step: 0.1, default: 0 },
  { name: 'num_beams', type: 'number', min: 1, max: 8, step: 1, integer: true, default: 3 },
  { name: 'max_tokens', type: 'number', min: 32, max: 4096, step: 1, integer: true, default: 1500 },
  { name: 'do_sample', type: 'boolean', default: true },
  { name: 'emotion_alpha', type: 'number', min: 0, max: 1, step: 0.05, default: 1 },
  { name: 'interval_silence_ms', type: 'number', min: 0, max: 2000, step: 10, integer: true, default: 200 },
  { name: 'use_emotion_text', type: 'boolean', default: false },
  { name: 'emotion_text', type: 'text', maxLength: 200, default: '' },
  { name: 'use_random_emotion', type: 'boolean', default: false },
];

export const AUDIOCPP_MODEL_SPECS: readonly AudioCppModelSpec[] = [
  {
    modelId: AUDIOCPP_CHATTERBOX_MODEL_ID,
    serverModelId: 'chatterbox',
    family: 'chatterbox',
    // `tts` is rejected outright by this loader: it accepts VoiceCloning and
    // VoiceConversion and nothing else.
    task: 'clon',
    mode: 'offline',
    weightsFile: 'chatterbox-q8_0.gguf',
    languages: ['en', 'tr', 'de', 'es', 'fr', 'it', 'pt', 'nl', 'pl', 'ko', 'ar', 'hi'],
    requiresVoiceReference: true,
    usesReferenceText: false,
    params: CHATTERBOX_PARAMS,
  },
  {
    modelId: AUDIOCPP_INDEXTTS2_MODEL_ID,
    serverModelId: 'index_tts2',
    family: 'index_tts2',
    // Its loader accepts Tts as well, but the request parser refuses any request
    // without speaker audio, so cloning is the only path that ever completes.
    task: 'clon',
    mode: 'offline',
    weightsFile: 'index-tts2-q8_0.gguf',
    languages: ['en', 'zh'],
    requiresVoiceReference: true,
    usesReferenceText: false,
    params: INDEXTTS2_PARAMS,
  },
];

const SPECS_BY_MODEL_ID = new Map(AUDIOCPP_MODEL_SPECS.map((spec) => [spec.modelId, spec]));

export const getAudioCppModelSpec = (modelId: string): AudioCppModelSpec | undefined => SPECS_BY_MODEL_ID.get(modelId);

export const isAudioCppModel = (modelId: string): boolean => SPECS_BY_MODEL_ID.has(modelId);

/** Every parameter at its shipped default, for "reset" and for a fresh record. */
export const defaultAudioCppParams = (modelId: string): VoiceParams => {
  const spec = getAudioCppModelSpec(modelId);
  if (!spec) return {};
  return Object.fromEntries(spec.params.map((param) => [param.name, param.default]));
};

export type AudioCppParamIssue = {
  key: string;
  /** `unknown` — no such parameter; `type` — wrong kind; `range` — out of bounds. */
  reason: 'unknown' | 'type' | 'range';
};

const checkValue = (spec: VoiceParamSpec, value: VoiceParamValue): AudioCppParamIssue['reason'] | null => {
  if (spec.type === 'boolean') return typeof value === 'boolean' ? null : 'type';
  if (spec.type === 'text') {
    if (typeof value !== 'string') return 'type';
    return value.length <= spec.maxLength ? null : 'range';
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'type';
  if (spec.integer && !Number.isInteger(value)) return 'range';
  return value >= spec.min && value <= spec.max ? null : 'range';
};

/**
 * Checks a parameter bag against a model's schema.
 *
 * Returns the first problem it finds, or `null` when every key is declared,
 * correctly typed and inside its bounds. A model with no schema accepts an
 * empty bag and nothing else, so an engine that grows parameters later cannot
 * silently start accepting them.
 */
export const validateAudioCppParams = (modelId: string, params: unknown): AudioCppParamIssue | null => {
  if (params === undefined) return null;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { key: '', reason: 'type' };
  }

  const spec = getAudioCppModelSpec(modelId);
  const declared = new Map((spec?.params ?? []).map((param) => [param.name, param]));

  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    const param = declared.get(key);
    if (!param) return { key, reason: 'unknown' };
    if (typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'string') {
      return { key, reason: 'type' };
    }
    const reason = checkValue(param, value);
    if (reason) return { key, reason };
  }
  return null;
};

/**
 * The parameters actually worth sending.
 *
 * A key left at its default is dropped rather than transmitted: the engine
 * applies the same value from its own struct initialiser, and an omitted key is
 * one fewer thing to be wrong about when upstream changes a default. An empty
 * string in a text parameter means "unset" and is dropped for the same reason —
 * `emotion_text: ""` is not what upstream's "no emotion text" looks like.
 */
export const wireParamsFor = (modelId: string, params: VoiceParams | undefined): VoiceParams => {
  const spec = getAudioCppModelSpec(modelId);
  if (!spec || !params) return {};

  const wire: VoiceParams = {};
  for (const param of spec.params) {
    const value = params[param.name];
    if (value === undefined || value === param.default) continue;
    if (param.type === 'text' && value === '') continue;
    if (checkValue(param, value) !== null) continue;
    wire[param.name] = value;
  }
  return wire;
};
