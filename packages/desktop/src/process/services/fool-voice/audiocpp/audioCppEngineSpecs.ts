/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AUDIOCPP_CHATTERBOX_MODEL_ID,
  AUDIOCPP_QWEN3_MODEL_ID,
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
  /**
   * Voices the weights already carry, addressed by name.
   *
   * The other engines here have no voice of their own and are given a recording
   * to imitate; this one ships a fixed cast and refuses a request that does not
   * name one of them — `500 Qwen3 custom voice prefill requires speaker`. The
   * name travels in the request's `voice` field, verified against a running
   * server: `voice: "Ryan"` returns byte-for-byte what the CLI's
   * `--speaker Ryan` does at the same seed.
   */
  presetSpeakers?: readonly { id: string; speaker: string; displayName: string; languages: readonly string[] }[];
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

/**
 * Chatterbox, the engine with a knob for how much feeling to put in.
 *
 * `exaggeration` was proved rather than read: with `--seed 42` fixed, two runs
 * at 0.25 produced byte-identical audio and a run at 2.0 produced different
 * audio. That test matters more here than anywhere else in this file, because
 * the server accepts an option name it does not know **without complaining** and
 * returns default-parameter audio — a misspelled knob is silent, not an error.
 *
 * The other three are the framework-wide sampling controls, spelled as the
 * server's own JSON keys.
 */
const CHATTERBOX_PARAMS: readonly VoiceParamSpec[] = [
  // Upstream's own range. 0.5 is neutral delivery; past ~1.5 it starts to
  // over-act, which is the point of offering it.
  { name: 'exaggeration', type: 'number', min: 0.25, max: 2, step: 0.05, default: 0.5 },
  { name: 'temperature', type: 'number', min: 0.05, max: 2, step: 0.05, default: 0.8 },
  { name: 'guidance_scale', type: 'number', min: 0, max: 5, step: 0.1, default: 0.5 },
  { name: 'text_chunk_size', type: 'number', min: 32, max: 1024, step: 1, integer: true, default: 256 },
];

/**
 * Qwen3 TTS, the one that is told how to sound in a sentence.
 *
 * `instruct` is why it is here. Every other engine in this app is directed with
 * a number at best; this one is given a line of English — "speak in a slow, sad
 * whisper" — and does it. Proved on real audio rather than read off a page: at
 * a pinned seed two plain runs were byte-identical, and adding the instruction
 * produced audio that was both different *and* a quarter longer, which is what
 * a slow whisper of the same sentence should be.
 *
 * Capped at a couple of sentences: it is a direction, and a long one starts
 * competing with the text that is meant to be spoken.
 */
const QWEN3_PARAMS: readonly VoiceParamSpec[] = [
  { name: 'instruct', type: 'text', maxLength: 300, default: '' },
  { name: 'temperature', type: 'number', min: 0.05, max: 2, step: 0.05, default: 0.8 },
  { name: 'top_p', type: 'number', min: 0, max: 1, step: 0.05, default: 0.95 },
  { name: 'text_chunk_size', type: 'number', min: 32, max: 1024, step: 1, integer: true, default: 256 },
];

/**
 * The cast the weights ship with, from the model card embedded in the GGUF.
 *
 * Listed here rather than discovered because the server has no endpoint that
 * reports them and answers an unknown name with `500 unsupported speaker` after
 * a cold model load — which on a CPU is a minute spent to be told no.
 */
const QWEN3_SPEAKERS = [
  { id: 'qwen3-ryan', speaker: 'Ryan', displayName: 'Ryan — dynamic, strong rhythm', languages: ['en'] },
  { id: 'qwen3-aiden', speaker: 'Aiden', displayName: 'Aiden — sunny American, clear midrange', languages: ['en'] },
  { id: 'qwen3-vivian', speaker: 'Vivian', displayName: 'Vivian — bright, slightly edgy', languages: ['zh'] },
  { id: 'qwen3-serena', speaker: 'Serena', displayName: 'Serena — warm and gentle', languages: ['zh'] },
  { id: 'qwen3-uncle-fu', speaker: 'Uncle_Fu', displayName: 'Uncle Fu — low, mellow, seasoned', languages: ['zh'] },
  { id: 'qwen3-dylan', speaker: 'Dylan', displayName: 'Dylan — Beijing, clear and natural', languages: ['zh'] },
  { id: 'qwen3-eric', speaker: 'Eric', displayName: 'Eric — Chengdu, husky brightness', languages: ['zh'] },
  { id: 'qwen3-ono-anna', speaker: 'Ono_Anna', displayName: 'Ono Anna — playful, light', languages: ['ja'] },
  { id: 'qwen3-sohee', speaker: 'Sohee', displayName: 'Sohee — warm, rich emotion', languages: ['ko'] },
] as const;

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
  {
    modelId: AUDIOCPP_CHATTERBOX_MODEL_ID,
    serverModelId: 'chatterbox',
    family: 'chatterbox',
    // `clon`, and it has to be: this loader rejects `tts` outright. Confirmed
    // by running the CLI against the installed weights — `--task clon` renders,
    // and it is also what the runtime's own header has said since Phase 2.
    task: 'clon',
    mode: 'offline',
    weightsFile: 'chatterbox-q8_0.gguf',
    languages: ['en'],
    requiresVoiceReference: true,
    // Builds a speaker embedding from the clip alone; a transcript would land
    // under a key it never reads.
    usesReferenceText: false,
    params: CHATTERBOX_PARAMS,
  },
  {
    modelId: AUDIOCPP_QWEN3_MODEL_ID,
    serverModelId: 'qwen3-tts',
    family: 'qwen3_tts',
    // `tts`, and the cloning-sounding name is a trap: run against the real
    // weights, `clon` answers `Qwen3 custom voice model only supports the Tts
    // task`. The same mistake that shipped Pocket broken — the task names the
    // session the loader builds, nothing about voices.
    task: 'tts',
    mode: 'offline',
    weightsFile: 'qwen3-tts-12hz-1.7b-customvoice-q8_0.gguf',
    languages: ['en', 'zh', 'ja', 'ko'],
    // It has its own cast; there is nothing to imitate and nothing to transcribe.
    requiresVoiceReference: false,
    usesReferenceText: false,
    presetSpeakers: QWEN3_SPEAKERS,
    params: QWEN3_PARAMS,
  },
];

const SPECS_BY_MODEL_ID = new Map(AUDIOCPP_MODEL_SPECS.map((spec) => [spec.modelId, spec]));

export const getAudioCppModelSpec = (modelId: string): AudioCppModelSpec | undefined => SPECS_BY_MODEL_ID.get(modelId);

export const isAudioCppModel = (modelId: string): boolean => SPECS_BY_MODEL_ID.has(modelId);

/**
 * The name a request must carry for a given preset voice, or `undefined`.
 *
 * `undefined` covers both "this engine has no cast" and "that profile is not
 * one of them", which are the same thing at the call site: send no `voice` and
 * let the engine's own rule about reference clips apply.
 */
export const presetSpeakerNameFor = (modelId: string, profileId: string): string | undefined =>
  getAudioCppModelSpec(modelId)?.presetSpeakers?.find((speaker) => speaker.id === profileId)?.speaker;

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
