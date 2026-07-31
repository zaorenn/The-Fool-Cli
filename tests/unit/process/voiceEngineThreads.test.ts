/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { ENGINE_THREADS, ttsThreadsFor } from '@process/services/fool-voice/voiceEngineSpecs';

/**
 * The cloning engine is the only voice anyone waits for.
 *
 * Piper renders a sentence in 82 ms and gains nothing from more cores; ZipVoice
 * runs an encoder, a flow-matching decoder and a vocoder over the same sentence.
 * They were given the same two threads, which throttled the slow one to keep the
 * fast one modest.
 */
describe('ttsThreadsFor', () => {
  it('leaves the light engines where they were', () => {
    for (const kind of ['vits', 'kokoro', 'kitten', 'matcha'] as const) {
      expect(ttsThreadsFor(kind, 16)).toBe(ENGINE_THREADS['text-to-speech']);
    }
  });

  it('gives the cloning engine half the machine', () => {
    expect(ttsThreadsFor('zipvoice', 8)).toBe(4);
  });

  it('caps it, because past this ONNX synchronises more than it computes', () => {
    expect(ttsThreadsFor('zipvoice', 32)).toBe(6);
  });

  // Half of a small machine is less than the engines already used; a two-core
  // laptop must not end up synthesising on one thread.
  it('never drops below what every other voice gets', () => {
    expect(ttsThreadsFor('zipvoice', 2)).toBe(ENGINE_THREADS['text-to-speech']);
    expect(ttsThreadsFor('zipvoice', 1)).toBe(ENGINE_THREADS['text-to-speech']);
  });

  it('survives a machine that will not say how many cores it has', () => {
    expect(ttsThreadsFor('zipvoice', 0)).toBe(ENGINE_THREADS['text-to-speech']);
    expect(ttsThreadsFor('zipvoice', Number.NaN)).toBe(ENGINE_THREADS['text-to-speech']);
  });
});
