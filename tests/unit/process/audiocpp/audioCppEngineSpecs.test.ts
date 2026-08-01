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
  validateAudioCppParams,
  wireParamsFor,
} from '@process/services/fool-voice/audiocpp/audioCppEngineSpecs';
import { AUDIOCPP_CHATTERBOX_MODEL_ID, AUDIOCPP_INDEXTTS2_MODEL_ID } from '@/common/types/foolVoice';

const CHATTERBOX = AUDIOCPP_CHATTERBOX_MODEL_ID;
const INDEXTTS2 = AUDIOCPP_INDEXTTS2_MODEL_ID;

describe('audio.cpp model specs', () => {
  it('describes both shipped models and nothing else', () => {
    expect(AUDIOCPP_MODEL_SPECS.map((spec) => spec.modelId)).toEqual([CHATTERBOX, INDEXTTS2]);
    expect(isAudioCppModel(CHATTERBOX)).toBe(true);
    expect(isAudioCppModel('tts-piper-en-libritts-r')).toBe(false);
  });

  // The config's `task` decides which session the loader builds, and Chatterbox
  // throws "Chatterbox supports VoiceCloning and VoiceConversion" for anything
  // else. `clone`, with an `e`, is UI metadata the parser does not know.
  it('asks the server for a cloning session, spelled the way the parser reads it', () => {
    for (const spec of AUDIOCPP_MODEL_SPECS) {
      expect(spec.task).toBe('clon');
      expect(spec.mode).toBe('offline');
    }
  });

  it('marks both models as unable to speak without a reference clip', () => {
    for (const spec of AUDIOCPP_MODEL_SPECS) {
      expect(spec.requiresVoiceReference).toBe(true);
      // Neither reads `reference_text`: both build a speaker embedding from the
      // audio alone.
      expect(spec.usesReferenceText).toBe(false);
    }
  });

  it('names Turkish among the languages Chatterbox speaks', () => {
    expect(getAudioCppModelSpec(CHATTERBOX)?.languages).toContain('tr');
  });

  // Every name here is the snake_case HTTP spelling. A hyphenated key is a CLI
  // flag: sent over HTTP it lands under a name no model reads, and synthesis
  // returns default-parameter audio while looking entirely successful.
  it('never declares a parameter under its CLI flag spelling', () => {
    for (const spec of AUDIOCPP_MODEL_SPECS) {
      for (const param of spec.params) {
        expect(param.name).not.toContain('-');
        expect(param.name).toBe(param.name.toLowerCase());
      }
    }
  });

  it('declares no parameter twice within a model', () => {
    for (const spec of AUDIOCPP_MODEL_SPECS) {
      expect(new Set(spec.params.map((param) => param.name)).size).toBe(spec.params.length);
    }
  });

  // Read from the struct initialisers, which are what applies when a key is
  // omitted. Upstream's own prose contradicts three of them.
  it.each([
    ['top_p', 1],
    ['repetition_penalty', 1.2],
    ['max_tokens', 384],
    ['guidance_scale', 0.5],
    ['temperature', 0.8],
    ['text_chunk_size', 128],
  ])('pins Chatterbox %s to the value the code uses', (name, expected) => {
    const param = getAudioCppModelSpec(CHATTERBOX)?.params.find((candidate) => candidate.name === name);
    expect(param?.default).toBe(expected);
  });

  it.each([
    ['top_p', 0.8],
    ['top_k', 30],
    ['repetition_penalty', 10],
    ['num_beams', 3],
    ['max_tokens', 1500],
    ['emotion_alpha', 1],
    ['interval_silence_ms', 200],
  ])('pins IndexTTS2 %s to the value the code uses', (name, expected) => {
    const param = getAudioCppModelSpec(INDEXTTS2)?.params.find((candidate) => candidate.name === name);
    expect(param?.default).toBe(expected);
  });

  it('keeps every default inside the range it declares', () => {
    for (const spec of AUDIOCPP_MODEL_SPECS) {
      expect(validateAudioCppParams(spec.modelId, defaultAudioCppParams(spec.modelId))).toBeNull();
    }
  });

  // The engine itself rejects these, and its rejection arrives as a 500 with
  // free-form text — indistinguishable from a real fault. Better refused here.
  it("keeps IndexTTS2's own bounds, so a value it would throw on never leaves", () => {
    expect(validateAudioCppParams(INDEXTTS2, { top_p: 0 })).toEqual({ key: 'top_p', reason: 'range' });
    expect(validateAudioCppParams(INDEXTTS2, { top_k: 0 })).toEqual({ key: 'top_k', reason: 'range' });
    expect(validateAudioCppParams(INDEXTTS2, { num_beams: 0 })).toEqual({ key: 'num_beams', reason: 'range' });
    expect(validateAudioCppParams(INDEXTTS2, { emotion_alpha: 1.5 })).toEqual({
      key: 'emotion_alpha',
      reason: 'range',
    });
    expect(validateAudioCppParams(INDEXTTS2, { interval_silence_ms: -1 })).toEqual({
      key: 'interval_silence_ms',
      reason: 'range',
    });
  });
});

describe('validateAudioCppParams', () => {
  it('accepts nothing at all', () => {
    expect(validateAudioCppParams(CHATTERBOX, undefined)).toBeNull();
    expect(validateAudioCppParams(CHATTERBOX, {})).toBeNull();
  });

  it('accepts a declared parameter inside its range', () => {
    expect(validateAudioCppParams(CHATTERBOX, { temperature: 1.2, do_sample: false })).toBeNull();
  });

  it('names an undeclared key rather than passing it through', () => {
    expect(validateAudioCppParams(CHATTERBOX, { speed: 1.5 })).toEqual({ key: 'speed', reason: 'unknown' });
  });

  // The hyphenated form is the exact mistake this schema exists to catch: it
  // would be accepted by the server, ignored by the model, and produce audio.
  it('rejects the CLI flag spelling of a parameter it does declare', () => {
    expect(validateAudioCppParams(CHATTERBOX, { 'top-p': 0.9 })).toEqual({ key: 'top-p', reason: 'unknown' });
  });

  it("rejects a parameter belonging to the other model's schema", () => {
    expect(validateAudioCppParams(CHATTERBOX, { num_beams: 3 })).toEqual({ key: 'num_beams', reason: 'unknown' });
    expect(validateAudioCppParams(INDEXTTS2, { exaggeration: 0.5 })).toEqual({
      key: 'exaggeration',
      reason: 'unknown',
    });
  });

  it('rejects the wrong type for a declared parameter', () => {
    expect(validateAudioCppParams(CHATTERBOX, { temperature: '1.2' })).toEqual({ key: 'temperature', reason: 'type' });
    expect(validateAudioCppParams(CHATTERBOX, { do_sample: 1 })).toEqual({ key: 'do_sample', reason: 'type' });
  });

  it('rejects a value outside the declared range', () => {
    expect(validateAudioCppParams(CHATTERBOX, { temperature: 9 })).toEqual({ key: 'temperature', reason: 'range' });
    expect(validateAudioCppParams(CHATTERBOX, { guidance_scale: -1 })).toEqual({
      key: 'guidance_scale',
      reason: 'range',
    });
  });

  it('rejects a fraction where the engine counts in whole tokens', () => {
    expect(validateAudioCppParams(CHATTERBOX, { max_tokens: 384.5 })).toEqual({ key: 'max_tokens', reason: 'range' });
  });

  it('rejects a non-finite number, which JSON would not survive anyway', () => {
    expect(validateAudioCppParams(CHATTERBOX, { temperature: Number.NaN })).toEqual({
      key: 'temperature',
      reason: 'type',
    });
  });

  it('rejects an over-long text parameter', () => {
    expect(validateAudioCppParams(INDEXTTS2, { emotion_text: 'a'.repeat(201) })).toEqual({
      key: 'emotion_text',
      reason: 'range',
    });
    expect(validateAudioCppParams(INDEXTTS2, { emotion_text: 'quietly amused' })).toBeNull();
  });

  it('rejects anything that is not an object of values', () => {
    expect(validateAudioCppParams(CHATTERBOX, [])).toEqual({ key: '', reason: 'type' });
    expect(validateAudioCppParams(CHATTERBOX, 'temperature=1')).toEqual({ key: '', reason: 'type' });
    expect(validateAudioCppParams(CHATTERBOX, { temperature: { value: 1 } })).toEqual({
      key: 'temperature',
      reason: 'type',
    });
  });

  // A model with no schema is not a model with a permissive schema.
  it('accepts nothing for a model that declares no parameters', () => {
    expect(validateAudioCppParams('tts-piper-en-libritts-r', {})).toBeNull();
    expect(validateAudioCppParams('tts-piper-en-libritts-r', { speed: 1 })).toEqual({
      key: 'speed',
      reason: 'unknown',
    });
  });
});

describe('wireParamsFor', () => {
  it('sends only what differs from the engine’s own default', () => {
    expect(wireParamsFor(CHATTERBOX, { temperature: 0.8, guidance_scale: 0.9 })).toEqual({ guidance_scale: 0.9 });
  });

  it('sends nothing when every value is the shipped default', () => {
    expect(wireParamsFor(CHATTERBOX, defaultAudioCppParams(CHATTERBOX))).toEqual({});
  });

  it('drops an empty text parameter rather than sending an empty string', () => {
    expect(wireParamsFor(INDEXTTS2, { emotion_text: '' })).toEqual({});
    expect(wireParamsFor(INDEXTTS2, { emotion_text: 'wistful' })).toEqual({ emotion_text: 'wistful' });
  });

  // Belt and braces behind the bridge validator: a stored record written by an
  // older build must not reach the engine as garbage.
  it('drops an unknown or out-of-range value instead of forwarding it', () => {
    expect(wireParamsFor(CHATTERBOX, { 'top-p': 0.5, temperature: 99, exaggeration: 1.5 })).toEqual({
      exaggeration: 1.5,
    });
  });

  it('sends nothing for a model with no schema', () => {
    expect(wireParamsFor('tts-piper-en-libritts-r', { speed: 2 })).toEqual({});
  });

  it('keeps booleans that were switched off, which are not the same as absent', () => {
    expect(wireParamsFor(CHATTERBOX, { do_sample: false })).toEqual({ do_sample: false });
  });
});
