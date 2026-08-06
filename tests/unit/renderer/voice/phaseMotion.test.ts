/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  applyMotionSetting,
  bandPosition,
  barHeight,
  PHASE_MOTION,
  ringDistance,
} from '@renderer/pages/voice/hud/phaseMotion';
import type { ConversationPhase } from '@renderer/pages/voice/runtime/types';

/**
 * Every phase has to look different, or the label is doing the instrument's job.
 *
 * The old meter drew connecting, thinking and working as the same low flat line,
 * so the only way to know which one you were in was to read the word underneath.
 * These are the assertions that keep them apart — sampled over a second, because
 * two motions that differ only in how they move are identical in any single
 * frame.
 */

const PHASES: ConversationPhase[] = [
  'idle',
  'connecting',
  'listening',
  'hearing',
  'thinking',
  'speaking',
  'acting',
  'standby',
];

/** A second of one phase, as the ring would be drawn frame by frame. */
const sample = (phase: ConversationPhase, level = 0): number[][] =>
  Array.from({ length: 30 }, (_frame, step) =>
    Array.from({ length: 24 }, (_bar, index) =>
      barHeight(PHASE_MOTION[phase], { position: index / 24, seconds: step / 30, level, shape: 1 })
    )
  );

const spread = (frames: number[][]): number => {
  const values = frames.flat();
  return Math.max(...values) - Math.min(...values);
};

describe('every phase moves differently', () => {
  it('gives each phase a motion of its own', () => {
    // A signature that captures both how tall the ring is and how uneven it is
    // — two phases with the same signature would be indistinguishable on screen.
    const signature = (phase: ConversationPhase): string => {
      const frames = sample(phase, 0.4);
      const total = frames.flat().reduce((sum, value) => sum + value, 0) / frames.flat().length;
      return `${total.toFixed(3)}/${spread(frames).toFixed(3)}`;
    };

    const seen = PHASES.map(signature);
    expect(new Set(seen).size).toBe(PHASES.length);
  });

  it('answers to the room only while it is hearing', () => {
    const quiet = sample('hearing', 0).flat();
    const loud = sample('hearing', 1).flat();
    expect(Math.max(...loud)).toBeGreaterThan(Math.max(...quiet) * 1.5);

    // Nothing else does: while the assistant is talking or working, the user is
    // not the one making the sound, and a ring that jumped at a passing lorry
    // would be lying about what it is showing.
    for (const phase of ['speaking', 'thinking', 'acting', 'connecting'] as const) {
      expect(sample(phase, 1).flat()).toEqual(sample(phase, 0).flat());
    }
  });

  it('tells thinking from working by how the band moves, not by how it looks', () => {
    const thinking = PHASE_MOTION.thinking.band;
    const acting = PHASE_MOTION.acting.band;

    expect(thinking?.steps).toBeNull();
    // Stepped, and the other way round: a machine being driven rather than a
    // thought being had.
    expect(acting?.steps).toBeGreaterThan(0);
    expect(Math.sign(acting?.speed ?? 0)).not.toBe(Math.sign(thinking?.speed ?? 0));
  });

  it('leaves idle still, so a page nobody is talking to is visibly not listening', () => {
    expect(spread(sample('idle', 1))).toBeLessThan(0.01);
  });
});

describe('bandPosition', () => {
  it('glides when it is not stepped', () => {
    const band = { speed: 1, width: 0.1, lift: 0.5, steps: null };
    expect(bandPosition(band, 0.25)).toBeCloseTo(0.25, 5);
    expect(bandPosition(band, 1.25)).toBeCloseTo(0.25, 5);
  });

  it('lands on a notch and stays there until the next one', () => {
    const band = { speed: 1, width: 0.1, lift: 0.5, steps: 4 };
    expect(bandPosition(band, 0.1)).toBe(0);
    expect(bandPosition(band, 0.24)).toBe(0);
    expect(bandPosition(band, 0.26)).toBe(0.25);
  });

  it('runs the other way for a negative speed', () => {
    const band = { speed: -1, width: 0.1, lift: 0.5, steps: null };
    expect(bandPosition(band, 0.25)).toBeCloseTo(0.75, 5);
  });
});

describe('ringDistance', () => {
  it('measures round the ring rather than along a line', () => {
    expect(ringDistance(0.05, 0.95)).toBeCloseTo(0.1, 5);
    expect(ringDistance(0.5, 0.5)).toBe(0);
    expect(ringDistance(0, 0.5)).toBeCloseTo(0.5, 5);
  });
});

describe('the motion setting', () => {
  it('drops what moves on its own but keeps what reports a value', () => {
    const calm = applyMotionSetting(PHASE_MOTION.thinking, 'calm');
    expect(calm.band).toBeNull();

    const listening = applyMotionSetting(PHASE_MOTION.listening, 'calm');
    expect(listening.breath).not.toBeNull();
    expect(listening.reactivity).toBeGreaterThan(0);
  });

  it('leaves nothing moving at all when asked for none', () => {
    const still = applyMotionSetting(PHASE_MOTION.hearing, 'none');
    expect(still.band).toBeNull();
    expect(still.breath).toBeNull();
    expect(still.reactivity).toBe(0);
  });

  it('changes nothing on full, which is what the design was drawn as', () => {
    expect(applyMotionSetting(PHASE_MOTION.acting, 'full')).toEqual(PHASE_MOTION.acting);
  });
});
