/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AUDIOCPP_CHATTERBOX_MODEL_ID,
  AUDIOCPP_INDEXTTS2_MODEL_ID,
  AUDIOCPP_MOSS_NANO_MODEL_ID,
  AUDIOCPP_POCKET_MODEL_ID,
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

/**
 * Pocket, run through audio.cpp.
 *
 * Defaults are `GenerationRequest` in
 * `include/engine/models/pocket_tts/types.h:46-59`, with `text_chunk_size` from
 * `src/models/pocket_tts/session.cpp:30`. Three of them are sentinels rather
 * than values — `max_steps: 0`, `frames_after_eos: -1` and `noise_clamp: -1`
 * all mean "let the model decide" — so each range starts at its sentinel and a
 * slider left alone sends nothing at all.
 *
 * `seed` is deliberately absent: the session draws a random one per request
 * when the key is missing, and pinning it is a debugging aid rather than a
 * voice control. `voice_embedding_path`, `noise_file` and `voice_clone_text`
 * are absent for the same reason — they are paths and stored clone data, not
 * knobs.
 */
const POCKET_PARAMS: readonly VoiceParamSpec[] = [
  { name: 'temperature', type: 'number', min: 0.05, max: 2, step: 0.05, default: 0.7 },
  { name: 'eos_threshold', type: 'number', min: -20, max: 0, step: 0.5, default: -4 },
  { name: 'noise_clamp', type: 'number', min: -1, max: 5, step: 0.1, default: -1 },
  { name: 'max_tokens', type: 'number', min: 10, max: 2048, step: 1, integer: true, default: 50 },
  { name: 'max_steps', type: 'number', min: 0, max: 4096, step: 1, integer: true, default: 0 },
  { name: 'frames_after_eos', type: 'number', min: -1, max: 100, step: 1, integer: true, default: -1 },
  { name: 'text_chunk_size', type: 'number', min: 32, max: 1024, step: 1, integer: true, default: 256 },
  { name: 'truncate_clone_audio', type: 'boolean', default: false },
];

/**
 * MOSS-TTS-Nano.
 *
 * Defaults are `MossTTSNanoSamplingOptions` and `MossTTSNanoGenerationOptions`
 * in `include/engine/models/moss/moss_tts_nano/types.h:11-27`. The model
 * samples text and audio through separate heads, which is why there are two
 * temperature/top-p/top-k triples rather than one: the `text_*` set shapes what
 * it decides to say, the unprefixed set shapes how it sounds.
 *
 * Two HTTP keys do not match the struct field they set, and the struct is not
 * where to read their names: `max_tokens` writes `max_new_frames`
 * (`session.cpp:71`), and `temperature`/`top_p`/`top_k`/`repetition_penalty`
 * write the `audio_*` fields (`session.cpp:97-108`).
 *
 * `active_codebooks` is bounded by the model's own `n_vq`, and a value above it
 * is a 500 rather than a clamp — so the ceiling here is the struct's 16. The
 * session sets the real default from the loaded config before reading options,
 * so a slider left alone still gets whatever that config says.
 */
const MOSS_NANO_PARAMS: readonly VoiceParamSpec[] = [
  { name: 'temperature', type: 'number', min: 0.05, max: 3, step: 0.05, default: 1.7 },
  { name: 'top_p', type: 'number', min: 0.05, max: 1, step: 0.05, default: 0.8 },
  { name: 'top_k', type: 'number', min: 1, max: 200, step: 1, integer: true, default: 25 },
  { name: 'repetition_penalty', type: 'number', min: 1, max: 4, step: 0.05, default: 1 },
  { name: 'text_temperature', type: 'number', min: 0.05, max: 3, step: 0.05, default: 1.5 },
  { name: 'text_top_p', type: 'number', min: 0.05, max: 1, step: 0.05, default: 1 },
  { name: 'text_top_k', type: 'number', min: 1, max: 200, step: 1, integer: true, default: 50 },
  { name: 'max_tokens', type: 'number', min: 32, max: 2048, step: 1, integer: true, default: 300 },
  { name: 'active_codebooks', type: 'number', min: 1, max: 16, step: 1, integer: true, default: 16 },
  { name: 'do_sample', type: 'boolean', default: true },
];

export const AUDIOCPP_MODEL_SPECS: readonly AudioCppModelSpec[] = [
  {
    modelId: AUDIOCPP_POCKET_MODEL_ID,
    serverModelId: 'pocket',
    family: 'pocket_tts',
    // Cloning only. Pocket does ship preset voices, but they are 26 separate
    // embedding files next to the weights and none of them is downloaded here —
    // this entry exists to give the cloned voices their parameters.
    task: 'clon',
    mode: 'offline',
    weightsFile: 'pocket-tts-english-q8_0.gguf',
    languages: ['en', 'de', 'it', 'pt', 'es'],
    requiresVoiceReference: true,
    // Pocket does read a clone transcript, but through the `voice_clone_text`
    // option rather than the request's `reference_text` field — which is what
    // this flag controls. Sending it there would land under a key it never reads.
    usesReferenceText: false,
    params: POCKET_PARAMS,
  },
  {
    modelId: AUDIOCPP_MOSS_NANO_MODEL_ID,
    serverModelId: 'moss_nano',
    family: 'moss_tts_nano',
    task: 'clon',
    mode: 'offline',
    weightsFile: 'moss-tts-nano-100m-q8_0.gguf',
    languages: [
      'en',
      'tr',
      'zh',
      'ja',
      'ko',
      'de',
      'fr',
      'es',
      'it',
      'pt',
      'ru',
      'ar',
      'fa',
      'pl',
      'cs',
      'da',
      'el',
      'hu',
      'sv',
    ],
    requiresVoiceReference: true,
    usesReferenceText: false,
    params: MOSS_NANO_PARAMS,
  },
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
