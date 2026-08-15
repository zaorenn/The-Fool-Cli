/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, type RefObject } from 'react';
import type { ConversationPhase } from '../runtime/types';
import { applyMotionSetting, barHeight, PHASE_MOTION, type MotionSetting } from './phaseMotion';
import styles from './VoiceHud.module.css';

/**
 * The level, wrapped into a ring, with a motion per phase.
 *
 * Same rule the straight meter was built on and the same reason it exists: the
 * only thing that moves is a value that moved. What the ring adds is that each
 * phase moves *differently*, so connecting, thinking and working stop being one
 * flat line with three different words under it.
 *
 * Drawn from an animation frame writing SVG attributes directly, never from
 * React state. The level changes many times a second and rendering the page that
 * often would cost more than the conversation does.
 */

/** Bars round the ring. Enough to read as a signal, few enough to stay cheap. */
const BARS = 76;

/** Where the bars start and how far they may reach, in the SVG's own units. */
const CENTRE = 160;
const INNER = 92;
const REACH = 34;

/** How fast a bar approaches its target: the inertia that makes it read as sound. */
const EASING = 0.24;

export type VoiceDialProps = {
  phase: ConversationPhase;
  /** Live microphone level, 0..1, read inside the animation frame. */
  level: RefObject<number>;
  /** How much the surface is allowed to move. */
  motion: MotionSetting;
  label: string;
};

const VoiceDial: React.FC<VoiceDialProps> = ({ phase, level, motion, label }) => {
  const barsRef = useRef<SVGGElement | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const motionRef = useRef(motion);
  motionRef.current = motion;

  useEffect(() => {
    const group = barsRef.current;
    if (!group) return;

    const bars = Array.from(group.querySelectorAll('line'));
    const heights = new Float32Array(BARS);
    // Someone who has asked the system for less movement gets it whatever the
    // layout says; the layout can only ask for less, never for more.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    const started = performance.now();

    /**
     * The half of every bar that cannot move, done once.
     *
     * `x1`/`y1` are the inner end of the spoke: centre plus a fixed radius at a
     * fixed angle. Nothing in the animation reaches them — not the level, not
     * the phase, not the clock — and they were being recomputed and rewritten
     * on every frame anyway. That is 152 of the 304 attribute writes this ring
     * was doing sixty times a second, in a window that is always on top and
     * therefore composited every frame, for a value that is the same as it was
     * the frame before.
     */
    const cosines = new Float32Array(BARS);
    const sines = new Float32Array(BARS);
    const envelopes = new Float32Array(BARS);
    /** What was last written, so a bar that has not moved is not written again. */
    const drawn = new Float32Array(BARS).fill(Number.NaN);

    for (let index = 0; index < BARS; index += 1) {
      const position = index / BARS;
      const angle = position * Math.PI * 2 - Math.PI / 2;
      cosines[index] = Math.cos(angle);
      sines[index] = Math.sin(angle);
      // A voice is loudest in the middle of its range, not evenly across it —
      // a ring of equal bars reads as a progress indicator rather than sound.
      envelopes[index] = 0.55 + 0.45 * Math.sin(position * Math.PI * 4 + index * 0.7);
      bars[index].setAttribute('x1', (CENTRE + cosines[index] * INNER).toFixed(2));
      bars[index].setAttribute('y1', (CENTRE + sines[index] * INNER).toFixed(2));
    }

    /**
     * How far a spoke must move before it is worth touching the DOM.
     *
     * The ring is drawn in a 320-unit box, so a twentieth of a unit is well
     * under a pixel at any size this window is ever given. Below it the write
     * changes nothing anybody can see and still costs an attribute parse and a
     * paint invalidation — which is the whole cost of `standby`, a phase whose
     * entire brief is to sit still and stay out of the way, and which is the
     * phase the assistant spends most of its life in.
     */
    const MOVED = 0.05;

    const paint = (now: number): void => {
      const seconds = (now - started) / 1000;
      const setting: MotionSetting = reduced ? 'none' : motionRef.current;
      const shape = applyMotionSetting(PHASE_MOTION[phaseRef.current], setting);
      const heard = level.current ?? 0;

      for (let index = 0; index < BARS; index += 1) {
        const target = barHeight(shape, {
          position: index / BARS,
          seconds,
          level: heard,
          shape: envelopes[index],
        });

        heights[index] += (target - heights[index]) * EASING;

        const length = 3 + heights[index] * REACH;
        if (Math.abs(length - drawn[index]) < MOVED) continue;
        drawn[index] = length;

        const bar = bars[index];
        bar.setAttribute('x2', (CENTRE + cosines[index] * (INNER + length)).toFixed(2));
        bar.setAttribute('y2', (CENTRE + sines[index] * (INNER + length)).toFixed(2));
      }

      frame = window.requestAnimationFrame(paint);
    };

    // Painted once even when nothing may move, so the ring is a ring rather than
    // a set of zero-length lines nobody can see.
    paint(performance.now());
    if (reduced || motionRef.current === 'none') {
      window.cancelAnimationFrame(frame);
      return;
    }

    return () => window.cancelAnimationFrame(frame);
  }, [level]);

  return (
    <svg
      className={styles.dial}
      viewBox='0 0 320 320'
      role='img'
      aria-label={label}
      data-testid='voice-dial'
      data-phase={phase}
    >
      {/* The fixed graticule: what the moving parts are read against. */}
      <circle className={styles.ring} cx={CENTRE} cy={CENTRE} r={118} />
      <circle className={styles.ringFaint} cx={CENTRE} cy={CENTRE} r={86} />
      <g className={styles.ticks}>
        {Array.from({ length: 24 }, (_unused, index) => {
          const angle = (index / 24) * Math.PI * 2 - Math.PI / 2;
          const length = index % 6 === 0 ? 9 : 4;
          return (
            <line
              key={index}
              x1={(CENTRE + Math.cos(angle) * 132).toFixed(2)}
              y1={(CENTRE + Math.sin(angle) * 132).toFixed(2)}
              x2={(CENTRE + Math.cos(angle) * (132 + length)).toFixed(2)}
              y2={(CENTRE + Math.sin(angle) * (132 + length)).toFixed(2)}
            />
          );
        })}
      </g>
      <g ref={barsRef} className={styles.bars}>
        {Array.from({ length: BARS }, (_unused, index) => (
          <line key={index} x1={CENTRE} y1={CENTRE - INNER} x2={CENTRE} y2={CENTRE - INNER} />
        ))}
      </g>
    </svg>
  );
};

export default VoiceDial;
