/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { earliestDecisionMs, savedMs, windowWhileSpeaking } from '@/common/voice/bargeIn';
import { DEFAULT_FOOL_VOICE_SETTINGS } from '@/common/types/foolVoice';

const configured = {
  minimumSpeechMs: DEFAULT_FOOL_VOICE_SETTINGS.vad.minimumSpeechMs,
  silenceMs: DEFAULT_FOOL_VOICE_SETTINGS.vad.silenceMs,
  maximumUtteranceMs: DEFAULT_FOOL_VOICE_SETTINGS.vad.maximumUtteranceMs,
};

describe('windowWhileSpeaking', () => {
  it('stops waiting for a sentence that was never going to be said', () => {
    // Somebody cutting in says one word and stops. Waiting most of a second
    // after it, to be sure they have finished, is the whole of the delay.
    expect(windowWhileSpeaking(configured).silenceMs).toBeLessThan(configured.silenceMs);
  });

  it('leaves the cough guard alone', () => {
    // The minimum speech length is what stops a chair, a keystroke or a cough
    // abandoning a reply. Shortening it is how the old energy-based version
    // failed.
    expect(windowWhileSpeaking(configured).minimumSpeechMs).toBe(configured.minimumSpeechMs);
  });

  it('does not widen a window the user has already narrowed', () => {
    const narrow = { minimumSpeechMs: 100, silenceMs: 120, maximumUtteranceMs: 2_000 };
    expect(windowWhileSpeaking(narrow)).toEqual(narrow);
  });

  it('caps a very long clip, so one monologue cannot hold the decision', () => {
    expect(windowWhileSpeaking(configured).maximumUtteranceMs).toBeLessThanOrEqual(4_000);
  });
});

describe('earliestDecisionMs', () => {
  it('is the sum of the two waits, before the recogniser has done anything', () => {
    expect(earliestDecisionMs(configured)).toBe(configured.minimumSpeechMs + configured.silenceMs);
  });

  it('is more than half a second shorter while a reply is being spoken', () => {
    // The figure this change is worth, as a number somebody can check rather
    // than a claim in a commit message.
    expect(savedMs(configured)).toBeGreaterThanOrEqual(500);
  });
});
