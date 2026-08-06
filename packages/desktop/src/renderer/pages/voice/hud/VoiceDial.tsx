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

    const paint = (now: number): void => {
      const seconds = (now - started) / 1000;
      const setting: MotionSetting = reduced ? 'none' : motionRef.current;
      const shape = applyMotionSetting(PHASE_MOTION[phaseRef.current], setting);
      const heard = level.current ?? 0;

      for (let index = 0; index < BARS; index += 1) {
        const position = index / BARS;
        // A voice is loudest in the middle of its range, not evenly across it —
        // a ring of equal bars reads as a progress indicator rather than sound.
        const envelope = 0.55 + 0.45 * Math.sin(position * Math.PI * 4 + index * 0.7);
        const target = barHeight(shape, { position, seconds, level: heard, shape: envelope });

        heights[index] += (target - heights[index]) * EASING;

        const length = 3 + heights[index] * REACH;
        const angle = position * Math.PI * 2 - Math.PI / 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const bar = bars[index];
        bar.setAttribute('x1', (CENTRE + cos * INNER).toFixed(2));
        bar.setAttribute('y1', (CENTRE + sin * INNER).toFixed(2));
        bar.setAttribute('x2', (CENTRE + cos * (INNER + length)).toFixed(2));
        bar.setAttribute('y2', (CENTRE + sin * (INNER + length)).toFixed(2));
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
