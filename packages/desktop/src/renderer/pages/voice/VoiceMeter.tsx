/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, type RefObject } from 'react';
import type { ConversationPhase } from './useRealtimeConversation';
import styles from './VoiceConversationPage.module.css';

/**
 * The one thing on the page that moves: the sound itself.
 *
 * What was here before was an orb with rotating rings and a blurred glow. It
 * looked identical while listening, thinking and speaking — so it said nothing
 * about the state it was drawn for, which makes it decoration rather than
 * interface. This is the opposite: every bar is the microphone's actual level, so
 * silence is visibly silence and a loud room is visibly a loud room.
 *
 * Drawn with its own animation frame from a ref, never from React state. The
 * level changes many times a second and rendering the page that often would cost
 * more than everything else the conversation does.
 */

/** Bars across the meter. Enough to read as a signal, few enough to stay cheap. */
const BARS = 48;

/** How fast a bar approaches its target: the inertia that makes it read as sound. */
const EASING = 0.22;

/** Height of the meter box in its own coordinate space. */
const BOX = 44;

export type VoiceMeterProps = {
  phase: ConversationPhase;
  /** Live microphone level, 0..1, read inside the animation frame. */
  level: RefObject<number>;
  label: string;
};

/**
 * How loud the meter should read for a phase the microphone cannot speak for.
 *
 * While the assistant is talking there is no input level worth drawing — the
 * user is not the one making the sound — so the bars carry the reply instead,
 * which is the only moment they are not literal.
 */
const drive = (phase: ConversationPhase, level: number): number => {
  if (phase === 'hearing') return Math.min(1, 0.25 + level * 2.4);
  if (phase === 'listening') return Math.min(0.5, 0.06 + level * 1.6);
  if (phase === 'speaking') return 0.62;
  if (phase === 'thinking' || phase === 'acting' || phase === 'connecting') return 0.09;
  return 0.02;
};

const VoiceMeter: React.FC<VoiceMeterProps> = ({ phase, level, label }) => {
  const groupRef = useRef<SVGGElement | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    const bars = Array.from(group.querySelectorAll('rect'));
    const heights = new Float32Array(BARS);
    const targets = new Float32Array(BARS);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;

    const paint = (): void => {
      const amp = drive(phaseRef.current, level.current ?? 0);

      for (let index = 0; index < BARS; index += 1) {
        // A fresh target now and then rather than every frame, so neighbouring
        // bars fall out of step the way a real level display does.
        if (Math.random() < 0.14) {
          // Quiet at the edges: a signal has a shape, a row of equal bars is a
          // progress indicator.
          const shape = Math.sin((index / (BARS - 1)) * Math.PI) ** 0.7;
          targets[index] = Math.random() * amp * shape;
        }
        heights[index] += (targets[index] - heights[index]) * EASING;

        const height = Math.max(1.5, heights[index] * BOX);
        const bar = bars[index];
        bar.setAttribute('y', String((BOX - height) / 2));
        bar.setAttribute('height', String(height));
        bar.setAttribute('opacity', String(0.3 + heights[index] * 0.7));
      }

      frame = window.requestAnimationFrame(paint);
    };

    if (reduced) {
      for (const bar of bars) bar.setAttribute('height', '2');
      return;
    }

    frame = window.requestAnimationFrame(paint);
    return () => window.cancelAnimationFrame(frame);
  }, [level]);

  const step = 100 / BARS;

  return (
    <svg
      className={styles.meter}
      viewBox={`0 0 100 ${BOX}`}
      preserveAspectRatio='none'
      role='img'
      aria-label={label}
      data-testid='voice-meter'
    >
      <g ref={groupRef}>
        {Array.from({ length: BARS }, (_, index) => (
          <rect
            key={index}
            x={index * step + step * 0.22}
            width={step * 0.56}
            y={BOX / 2 - 1}
            height={2}
            rx={step * 0.22}
          />
        ))}
      </g>
    </svg>
  );
};

export default VoiceMeter;
