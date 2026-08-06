/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ConversationPhase } from '../runtime/types';

/**
 * What each phase looks like when it moves.
 *
 * The old meter drew every non-speaking phase the same way — a low flat line —
 * so connecting, thinking and working were indistinguishable, and the only way
 * to know which one you were in was to read the word underneath. That is a label
 * doing the work the instrument was put there to do.
 *
 * So each phase gets a motion of its own, and they are chosen to be told apart
 * at a glance and from across a room rather than to be pretty:
 *
 * - **connecting** — one short arc chases round the rim. Something is being
 *   established and has not arrived.
 * - **listening** — the whole ring breathes, slowly and evenly. Alive, not
 *   reactive; nothing is being said yet.
 * - **hearing** — the ring is the microphone, bar by bar. The only phase that
 *   answers to the room, which is what makes it unmistakable.
 * - **thinking** — a bright band glides round a flat ring. Reading, not acting.
 * - **working** — the same band, but stepped: it jumps a notch at a time, the
 *   way a machine moves rather than the way a thought does. That difference is
 *   the whole point — thinking is quick and free, working is minutes of somebody
 *   else's computer being driven.
 * - **speaking** — accent-coloured, amplitude from a speech envelope rather than
 *   from the microphone, because the user is not the one making the sound.
 * - **standby** — everything still, one slow pulse. Present and deliberately
 *   silent.
 *
 * Kept as data, and pure, so the motions can be compared side by side in a test
 * without a canvas or a clock.
 */

/** How the ring is driven for one phase. */
export type PhaseMotion = {
  /** Base amplitude before any travelling band, 0..1. */
  amplitude: number;
  /** How strongly the live microphone level moves it. */
  reactivity: number;
  /** A band travelling round the ring, or none. */
  band: null | {
    /** Turns per second. Negative runs anticlockwise. */
    speed: number;
    /** How wide the band is, as a fraction of the ring. */
    width: number;
    /** How high the band lifts a bar, added to the amplitude. */
    lift: number;
    /** Positions the band may occupy — a stepped band jumps between them. */
    steps: number | null;
  };
  /** A whole-ring rise and fall, in seconds per breath, or none. */
  breath: number | null;
  /** Which of the surface's colours the bars take. */
  ink: 'accent' | 'bright' | 'dim' | 'faint';
};

const STILL: PhaseMotion = { amplitude: 0.02, reactivity: 0, band: null, breath: null, ink: 'faint' };

export const PHASE_MOTION: Record<ConversationPhase, PhaseMotion> = {
  idle: STILL,
  connecting: {
    amplitude: 0.05,
    reactivity: 0,
    band: { speed: 0.9, width: 0.06, lift: 0.5, steps: null },
    breath: null,
    ink: 'faint',
  },
  listening: { amplitude: 0.1, reactivity: 0.5, band: null, breath: 4.2, ink: 'dim' },
  hearing: { amplitude: 0.18, reactivity: 2.3, band: null, breath: null, ink: 'bright' },
  thinking: {
    amplitude: 0.05,
    reactivity: 0,
    band: { speed: 0.75, width: 0.12, lift: 0.62, steps: null },
    breath: null,
    ink: 'dim',
  },
  acting: {
    amplitude: 0.05,
    reactivity: 0,
    // Stepped and slower, and the other way round: a machine being driven, not a
    // thought being had. Twenty-four notches is one per graticule mark, so the
    // band lands on the ticks rather than between them.
    band: { speed: -0.32, width: 0.1, lift: 0.66, steps: 24 },
    breath: null,
    ink: 'dim',
  },
  speaking: { amplitude: 0.52, reactivity: 0, band: null, breath: null, ink: 'accent' },
  standby: { amplitude: 0.03, reactivity: 0, band: null, breath: 6, ink: 'faint' },
};

/**
 * How much of a motion survives the layout's motion setting.
 *
 * `calm` keeps everything that reports a real value — the level, the breath —
 * and drops the travelling bands, which are the parts that move on their own.
 * `none` leaves only what a static picture can say. Neither is a lesser version
 * of the design: someone who finds a moving ring distracting still needs to be
 * able to tell hearing from working.
 */
export type MotionSetting = 'full' | 'calm' | 'none';

export const applyMotionSetting = (motion: PhaseMotion, setting: MotionSetting): PhaseMotion => {
  if (setting === 'full') return motion;
  if (setting === 'calm') return { ...motion, band: null };
  return { ...motion, band: null, breath: null, reactivity: 0 };
};

/**
 * Where the band is at this moment, as a position round the ring, 0..1.
 *
 * Split out because the stepped case is the interesting one: `acting` has to
 * land on a notch and stay there until the next, and a caller doing that
 * arithmetic inline would get a band that stutters rather than steps.
 */
export const bandPosition = (band: NonNullable<PhaseMotion['band']>, seconds: number): number => {
  const turns = seconds * band.speed;
  const raw = turns - Math.floor(turns);
  if (band.steps === null) return raw;
  return Math.floor(raw * band.steps) / band.steps;
};

/**
 * How far one bar is from the band, as a fraction of the ring, 0..0.5.
 *
 * Wrapped, so a band sitting at the seam lifts the bars on both sides of it
 * rather than being cut in half by the coordinate system.
 */
export const ringDistance = (from: number, to: number): number => {
  const gap = Math.abs(from - to) % 1;
  return Math.min(gap, 1 - gap);
};

/** How high one bar stands, 0..1, for a phase at a moment with a level in the room. */
export const barHeight = (
  motion: PhaseMotion,
  options: { position: number; seconds: number; level: number; shape: number }
): number => {
  const breath = motion.breath === null ? 1 : 0.55 + 0.45 * Math.sin((options.seconds / motion.breath) * Math.PI * 2);
  let height = (motion.amplitude + motion.reactivity * options.level) * breath * options.shape;

  if (motion.band) {
    const distance = ringDistance(options.position, bandPosition(motion.band, options.seconds));
    if (distance < motion.band.width) {
      // Smooth shoulders, so the band reads as a sweep of light rather than as a
      // block of bars switching on together.
      const nearness = 1 - distance / motion.band.width;
      height += motion.band.lift * nearness * nearness;
    }
  }

  return Math.max(0, Math.min(1, height));
};
