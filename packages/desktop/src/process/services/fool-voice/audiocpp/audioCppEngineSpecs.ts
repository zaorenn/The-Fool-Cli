/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
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
   * True for Pocket: it loads as a plain-TTS session but produces nothing
   * usable without a reference clip to imitate.
   */
  requiresVoiceReference: boolean;
  /** Whether the engine reads `reference_text`. Pocket does not. */
  usesReferenceText: boolean;
  params: readonly VoiceParamSpec[];
};

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

export const AUDIOCPP_MODEL_SPECS: readonly AudioCppModelSpec[] = [
  {
    modelId: AUDIOCPP_POCKET_MODEL_ID,
    serverModelId: 'pocket',
    family: 'pocket_tts',
    // `tts`, and it has to be: this loader answers anything else with
    // "PocketTTS only supports VoiceTaskKind::Tts". The task names the session
    // the loader builds, not whether a voice is cloned — Pocket clones from a
    // `voice_ref` inside a `tts` session, measured at 0.43 s a sentence here.
    task: 'tts',
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
