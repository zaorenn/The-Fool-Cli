/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  CIRCLING_ROUNDS,
  LARGE_PROMPT_CHARS,
  SLOW_FIRST_AUDIO_MS,
  concernsFor,
  describeTurn,
  type TurnMetrics,
} from '@/common/voice/turnMetrics';

const turn = (over: Partial<TurnMetrics> = {}): TurnMetrics => ({
  rounds: 1,
  promptChars: 5_000,
  toFirstAudioMs: 800,
  totalMs: 3_000,
  toolCalls: 0,
  ...over,
});

describe('describeTurn', () => {
  it('carries every number a speed argument needs', () => {
    expect(describeTurn(turn({ rounds: 2, toolCalls: 1 }))).toBe(
      'rounds=2 prompt=5000c firstAudio=800ms total=3000ms tools=1'
    );
  });

  it('says so when nothing was ever spoken', () => {
    // A refused claim or a pure tool run produces no audio, and recording zero
    // would make the average latency look better than anybody experienced.
    expect(describeTurn(turn({ toFirstAudioMs: null }))).toContain('firstAudio=none');
  });
});

describe('concernsFor', () => {
  it('is quiet about an ordinary turn', () => {
    expect(concernsFor(turn())).toEqual([]);
  });

  it('notices the only latency the user feels', () => {
    // Total time matters far less: a reply that starts in 400ms and runs for
    // eight seconds feels immediate; one that arrives whole after three does not.
    expect(concernsFor(turn({ toFirstAudioMs: SLOW_FIRST_AUDIO_MS + 1 }))).toContain('slow-first-audio');
    expect(concernsFor(turn({ totalMs: 60_000 }))).toEqual([]);
  });

  it('notices a model going round in circles', () => {
    expect(concernsFor(turn({ rounds: CIRCLING_ROUNDS }))).toContain('circling');
  });

  it('notices a prompt that has quietly grown', () => {
    expect(concernsFor(turn({ promptChars: LARGE_PROMPT_CHARS + 1 }))).toContain('large-prompt');
  });

  it('reports every concern a bad turn has, not just the first', () => {
    const concerns = concernsFor(turn({ rounds: 9, promptChars: 90_000, toFirstAudioMs: 30_000 }));

    expect(concerns.sort()).toEqual(['circling', 'large-prompt', 'slow-first-audio']);
  });
});
