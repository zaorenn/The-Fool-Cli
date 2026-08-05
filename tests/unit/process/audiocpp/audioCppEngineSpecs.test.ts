/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  AUDIOCPP_MODEL_SPECS,
  defaultAudioCppParams,
  getAudioCppModelSpec,
  isAudioCppModel,
  presetSpeakerNameFor,
  validateAudioCppParams,
  wireParamsFor,
} from '@process/services/fool-voice/audiocpp/audioCppEngineSpecs';
import {
  AUDIOCPP_CHATTERBOX_MODEL_ID,
  AUDIOCPP_POCKET_MODEL_ID,
  AUDIOCPP_QWEN3_MODEL_ID,
} from '@/common/types/foolVoice';

const POCKET = AUDIOCPP_POCKET_MODEL_ID;
const CHATTERBOX = AUDIOCPP_CHATTERBOX_MODEL_ID;
const QWEN3 = AUDIOCPP_QWEN3_MODEL_ID;

/**
 * Three engines, and which one is here for which reason is the whole point.
 *
 * Pocket is the one a conversation is held in: 0.43 s a sentence warm, 1.20 s
 * cold. The other two are here to *make* a voice rather than to speak in one,
 * and they were measured on this hardware before being let back in —
 * Chatterbox at 39.5 s a sentence, Qwen3 in the same class. Both were withdrawn
 * once for exactly that, and nothing about the measurement has changed; what
 * changed is that they are the only engines that take a direction — an
 * `exaggeration` number, or an `instruct` sentence — and that is what they are
 * offered for.
 *
 * IndexTTS2 stays out. It was measured at 1 m 47 s a sentence here and it takes
 * no direction, so it is slower than Chatterbox for strictly less.
 */
describe('audio.cpp model specs', () => {
  it('describes every shipped model and nothing else', () => {
    expect(AUDIOCPP_MODEL_SPECS.map((spec) => spec.modelId)).toEqual([POCKET, CHATTERBOX, QWEN3]);
    expect(isAudioCppModel(POCKET)).toBe(true);
    expect(isAudioCppModel('tts-audiocpp-indextts2')).toBe(false);
    expect(isAudioCppModel('tts-piper-en-libritts-r')).toBe(false);
  });

  /**
   * The session kind is per model and each of these was run before it was
   * written down: Pocket renders under `tts` and answers `clon` with
   * `500 PocketTTS only supports VoiceTaskKind::Tts`; Chatterbox renders under
   * `clon`; and Qwen3, which clones, still refuses anything but `tts`.
   */
  it('asks each engine for the session kind its own loader accepts', () => {
    expect(getAudioCppModelSpec(CHATTERBOX)?.task).toBe('clon');
    expect(getAudioCppModelSpec(CHATTERBOX)?.family).toBe('chatterbox');
    // Cloning notwithstanding: `clon` is answered with
    // `Qwen3 custom voice model only supports the Tts task`.
    expect(getAudioCppModelSpec(QWEN3)?.task).toBe('tts');
    expect(getAudioCppModelSpec(QWEN3)?.family).toBe('qwen3_tts');
  });

  /**
   * Neither can say anything until the user gives it a voice to imitate, and
   * only Qwen3 reads the clip's transcript.
   */
  it('says which of them needs a clip, and which reads its transcript', () => {
    expect(getAudioCppModelSpec(CHATTERBOX)?.requiresVoiceReference).toBe(true);
    expect(getAudioCppModelSpec(CHATTERBOX)?.usesReferenceText).toBe(false);
    // Qwen3 ships its own cast: there is nothing to imitate, and naming one of
    // them is what the request carries instead of a recording.
    expect(getAudioCppModelSpec(QWEN3)?.requiresVoiceReference).toBe(false);
    expect(getAudioCppModelSpec(QWEN3)?.usesReferenceText).toBe(false);
    expect(presetSpeakerNameFor(QWEN3, 'qwen3-ryan')).toBe('Ryan');
    // A cloned voice is not one of the cast, and neither is a made-up id.
    expect(presetSpeakerNameFor(QWEN3, 'cloned:jarvis')).toBeUndefined();
    expect(presetSpeakerNameFor(CHATTERBOX, 'qwen3-ryan')).toBeUndefined();
  });

  /**
   * The knobs that make these two worth their download.
   *
   * `exaggeration` was proved on real audio rather than read off a page: with
   * the seed pinned, two runs at 0.25 were byte-identical and a run at 2.0 was
   * not. That test is not optional here — the server accepts an option name it
   * does not know without complaining and returns default audio, so a
   * misspelled knob fails silently.
   */
  it('carries the one control each engine exists for', () => {
    const chatterbox = getAudioCppModelSpec(CHATTERBOX)?.params.map((param) => param.name);
    expect(chatterbox).toContain('exaggeration');

    const qwen3 = getAudioCppModelSpec(QWEN3)?.params.map((param) => param.name);
    expect(qwen3).toContain('instruct');
  });

  it('keeps a direction inside its declared bounds', () => {
    expect(validateAudioCppParams(CHATTERBOX, { exaggeration: 0.5 })).toBeNull();
    expect(validateAudioCppParams(CHATTERBOX, { exaggeration: 9 })).toEqual({
      key: 'exaggeration',
      reason: 'range',
    });
    expect(validateAudioCppParams(QWEN3, { instruct: 'Speak slowly, as if telling a secret.' })).toBeNull();
    expect(validateAudioCppParams(QWEN3, { instruct: 'x'.repeat(400) })).toEqual({
      key: 'instruct',
      reason: 'range',
    });
  });

  /**
   * The task is per model, and assuming otherwise is what shipped Pocket
   * broken: every entry declared `clon`, because Chatterbox accepted nothing
   * else, and Pocket answers that with
   * `500 PocketTTS only supports VoiceTaskKind::Tts`.
   *
   * It names the session the loader builds, not whether a voice gets cloned —
   * Pocket clones from a `voice_ref` inside a `tts` session.
   */
  it('asks Pocket for the only session kind its loader accepts', () => {
    expect(getAudioCppModelSpec(POCKET)?.task).toBe('tts');
    expect(getAudioCppModelSpec(POCKET)?.mode).toBe('offline');
  });

  it('cannot speak without a reference clip, session kind notwithstanding', () => {
    expect(getAudioCppModelSpec(POCKET)?.requiresVoiceReference).toBe(true);
  });

  // Pocket does read a clone transcript, but through its own `voice_clone_text`
  // option — sent as the request's `reference_text` it lands under a key
  // nothing looks at.
  it('does not claim Pocket reads the reference transcript', () => {
    expect(getAudioCppModelSpec(POCKET)?.usesReferenceText).toBe(false);
  });

  it('names the weights file the installer puts on disk', () => {
    expect(getAudioCppModelSpec(POCKET)?.weightsFile).toBe('pocket-tts-english-q8_0.gguf');
    expect(getAudioCppModelSpec(POCKET)?.family).toBe('pocket_tts');
  });

  /**
   * Every default is `GenerationRequest` in
   * `include/engine/models/pocket_tts/types.h:46-59`, except `text_chunk_size`
   * which is `kDefaultTextChunkSize` in `src/models/pocket_tts/session.cpp:30`.
   *
   * Read from the code rather than the documentation on purpose: upstream's
   * prose disagreed with its own struct initialisers for three of Chatterbox's
   * values, and a wrong default here is inaudible — the voice simply is not
   * what it should be, with nothing on screen to say so.
   */
  it('carries Pocket’s defaults as its own header declares them', () => {
    expect(defaultAudioCppParams(POCKET)).toEqual({
      temperature: 0.7,
      eos_threshold: -4,
      noise_clamp: -1,
      max_tokens: 50,
      max_steps: 0,
      frames_after_eos: -1,
      text_chunk_size: 256,
      truncate_clone_audio: false,
    });
  });

  // Three defaults are sentinels meaning "the model decides", so a range that
  // started above them would put the default out of reach after one drag.
  it('lets the sentinel defaults be selected again', () => {
    for (const name of ['max_steps', 'frames_after_eos', 'noise_clamp']) {
      const spec = getAudioCppModelSpec(POCKET)?.params.find((param) => param.name === name);
      if (spec?.type !== 'number') throw new Error(`${name} must be numeric`);
      expect(spec.min).toBeLessThanOrEqual(spec.default);
      expect(spec.max).toBeGreaterThanOrEqual(spec.default);
    }
  });

  it('rejects a key the model does not declare', () => {
    expect(validateAudioCppParams(POCKET, { top_p: 0.8 })).toEqual({ key: 'top_p', reason: 'unknown' });
    expect(validateAudioCppParams(POCKET, { temperature: 0.4 })).toBeNull();
  });

  it('rejects the wrong type and a value outside the declared bounds', () => {
    expect(validateAudioCppParams(POCKET, { temperature: 'warm' })).toEqual({ key: 'temperature', reason: 'type' });
    expect(validateAudioCppParams(POCKET, { temperature: 99 })).toEqual({ key: 'temperature', reason: 'range' });
    expect(validateAudioCppParams(POCKET, { max_tokens: 12.5 })).toEqual({ key: 'max_tokens', reason: 'range' });
  });

  it('accepts an empty bag, and refuses parameters for a model with no schema', () => {
    expect(validateAudioCppParams(POCKET, {})).toBeNull();
    expect(validateAudioCppParams(POCKET, undefined)).toBeNull();
    expect(validateAudioCppParams('tts-piper-en-libritts-r', { temperature: 0.5 })).toEqual({
      key: 'temperature',
      reason: 'unknown',
    });
  });

  /**
   * A key left at its default is dropped rather than transmitted: the engine
   * applies the same value from its own struct initialiser, and an omitted key
   * is one fewer thing to be wrong about when upstream changes a default.
   */
  it('sends only what the user actually changed', () => {
    expect(wireParamsFor(POCKET, { temperature: 0.7, eos_threshold: -6 })).toEqual({ eos_threshold: -6 });
    expect(wireParamsFor(POCKET, defaultAudioCppParams(POCKET))).toEqual({});
    expect(wireParamsFor(POCKET, undefined)).toEqual({});
  });

  it('drops a value the schema would have rejected rather than sending it on', () => {
    expect(wireParamsFor(POCKET, { temperature: 99, eos_threshold: -6 })).toEqual({ eos_threshold: -6 });
  });

  it('sends nothing for a model it has no schema for', () => {
    expect(wireParamsFor('tts-piper-en-libritts-r', { temperature: 0.5 })).toEqual({});
  });
});
