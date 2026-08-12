/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runs a skin against a canvas, and owns everything a skin should not have to.
 *
 * Device pixel ratio, resizing, the animation frame, easing the level and
 * honouring reduced motion all live here rather than in each skin. That
 * division is the reason a new look is one small file: an author writing a skin
 * is drawing a picture, and every one of those five things is a way to get a
 * picture subtly wrong that has nothing to do with how it looks.
 *
 * Reduced motion freezes `time` rather than stopping the loop. The orb still
 * responds to the microphone — which is information, not decoration, and the
 * one thing somebody who dislikes animation still needs from it.
 */

import type { VoiceStage } from '@/common/types/voiceStage';
import { orbPalette } from './palette';
import { orbSkinById } from './skins';
import type { OrbSkin } from './types';

/** How much of the gap to the target level each frame closes. */
const EASE = 0.05;

/**
 * How lively each stage is when the microphone is not saying otherwise.
 *
 * The level arriving over IPC is real only while speech is being heard; the
 * rest of the time it is zero, and an orb that went flat every time the user
 * stopped talking would look like it had stopped working.
 */
const ENERGY: Record<VoiceStage, number> = {
  off: 0.15,
  listening: 0.3,
  hearing: 0.85,
  processing: 0.5,
  generating: 0.55,
  speaking: 0.8,
};

export type OrbHandle = {
  /** What the conversation is doing. */
  setStage: (stage: VoiceStage) => void;
  /** Microphone level, 0..1. Only meaningful while hearing. */
  setLevel: (level: number) => void;
  /** The app's accent, as a hex string, exactly as the theme resolved it. */
  setAccent: (hex: string) => void;
  /** Swap the look. Takes effect on the next frame, with no reload. */
  setSkin: (id: string) => void;
  /** Which skin is drawing, so a caller can show its name. */
  currentSkin: () => OrbSkin;
  stop: () => void;
};

export const mountOrb = (canvas: HTMLCanvasElement, options: { skin?: string; accent?: string } = {}): OrbHandle => {
  const context = canvas.getContext('2d');
  let skin = orbSkinById(options.skin);
  let accent = options.accent ?? '#c4123f';
  let stage: VoiceStage = 'off';
  /** What the microphone last reported, before easing. */
  let target = ENERGY.off;
  let level = ENERGY.off;
  let running = true;
  let startedAt = 0;

  const reduced =
    typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  const resize = (): void => {
    if (!context) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);
  resize();

  const frame = (now: number): void => {
    if (!running || !context) return;
    if (startedAt === 0) startedAt = now;

    // Re-measured every frame rather than only on resize: the pet window is
    // resized by the main process without the observer necessarily having run
    // before the next paint, and a stale size draws the orb off-centre.
    resize();
    const rect = canvas.getBoundingClientRect();

    level += (target - level) * EASE;
    context.clearRect(0, 0, rect.width, rect.height);

    skin.draw({
      ctx: context,
      width: rect.width,
      height: rect.height,
      time: reduced?.matches === true ? 0 : now - startedAt,
      level,
      stage,
      palette: orbPalette(accent, stage),
    });

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    setStage: (next) => {
      stage = next;
      target = ENERGY[next] ?? ENERGY.off;
    },
    // Taken as a floor rather than as the value: the stage's own energy is what
    // the orb looks like between words, and a microphone reading of zero in the
    // middle of a sentence is a gap in speech, not the conversation ending.
    setLevel: (next) => {
      const heard = Math.min(1, Math.max(0, next));
      target = Math.max(ENERGY[stage] ?? ENERGY.off, heard);
    },
    setAccent: (hex) => {
      if (hex.trim().length > 0) accent = hex;
    },
    setSkin: (id) => {
      skin = orbSkinById(id);
    },
    currentSkin: () => skin,
    stop: () => {
      running = false;
      observer?.disconnect();
    },
  };
};
