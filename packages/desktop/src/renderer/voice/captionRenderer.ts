/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { VoiceStageEvent } from '@/common/types/voiceStage';

/**
 * Draws the caption strip.
 *
 * Deliberately dependency-free: this window is one card, and pulling React and
 * the i18n runtime into a second renderer to draw a waveform and a sentence
 * would cost more than it explains. Labels arrive already translated from the
 * main window, which owns the language.
 *
 * The waveform is a real oscilloscope, not decoration: every frame it appends the
 * microphone's current level to a ring buffer and redraws the whole trace, so the
 * shape on screen is the shape of what was said a moment ago, scrolling away to
 * the left. Between utterances the trace relaxes to a slow travelling ripple
 * rather than stopping dead.
 */

declare global {
  interface Window {
    voiceCaptionAPI: {
      onCaption: (callback: (event: VoiceStageEvent) => void) => () => void;
    };
  }
}

const card = document.getElementById('card') as HTMLDivElement;
const stageLabel = document.getElementById('stage') as HTMLSpanElement;
const hint = document.getElementById('hint') as HTMLSpanElement;
const canvas = document.getElementById('wave') as HTMLCanvasElement;
const transcript = document.getElementById('transcript') as HTMLDivElement;
const context = canvas.getContext('2d');

/** One sample per frame at 60fps: about two seconds of history on screen. */
const SAMPLE_COUNT = 128;
const samples = new Float32Array(SAMPLE_COUNT);

let accent = '#c4123f';
let live = false;
let currentLevel = 0;
let idlePhase = 0;
let running = false;

const resize = (): void => {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context?.setTransform(ratio, 0, 0, ratio, 0, 0);
};

/** Converts `#rrggbb` to `rgba(r, g, b, alpha)`. */
const withAlpha = (hex: string, alpha: number): string => {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value.slice(0, 6);
  const red = Number.parseInt(full.slice(0, 2), 16) || 0;
  const green = Number.parseInt(full.slice(2, 4), 16) || 0;
  const blue = Number.parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const push = (level: number): void => {
  samples.copyWithin(0, 1);
  samples[SAMPLE_COUNT - 1] = level;
};

/**
 * A smooth mirrored trace through the samples.
 *
 * Midpoint-quadratic smoothing rather than straight segments: speech is not
 * piecewise linear, and the curve is what makes this read as sound.
 */
const traceEdge = (width: number, height: number, direction: 1 | -1): void => {
  if (!context) return;
  const middle = height / 2;
  const step = width / (SAMPLE_COUNT - 1);
  const amplitude = middle - 2;

  const pointAt = (index: number): [number, number] => [
    index * step,
    middle - direction * Math.min(1, samples[index]) * amplitude,
  ];

  let [previousX, previousY] = pointAt(0);
  context.lineTo(previousX, previousY);

  for (let index = 1; index < SAMPLE_COUNT; index += 1) {
    const [x, y] = pointAt(index);
    context.quadraticCurveTo(previousX, previousY, (previousX + x) / 2, (previousY + y) / 2);
    previousX = x;
    previousY = y;
  }
  context.lineTo(previousX, previousY);
};

const draw = (): void => {
  if (!context) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const middle = height / 2;

  context.clearRect(0, 0, width, height);

  // Baseline: always there, so silence still looks like an instrument.
  context.strokeStyle = withAlpha(accent, 0.18);
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, middle);
  context.lineTo(width, middle);
  context.stroke();

  // The body of the trace, filled from a vertical gradient.
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, withAlpha(accent, 0.42));
  gradient.addColorStop(0.5, withAlpha(accent, 0.14));
  gradient.addColorStop(1, withAlpha(accent, 0.42));

  context.beginPath();
  context.moveTo(0, middle);
  traceEdge(width, height, 1);
  traceEdge(width, height, -1);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();

  // The lit edges.
  context.lineWidth = 1.6;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.strokeStyle = withAlpha(accent, live ? 0.95 : 0.5);
  context.shadowColor = withAlpha(accent, live ? 0.55 : 0.2);
  context.shadowBlur = live ? 10 : 4;

  for (const direction of [1, -1] as const) {
    context.beginPath();
    traceEdge(width, height, direction);
    context.stroke();
  }
  context.shadowBlur = 0;

  // The leading edge: where sound is arriving right now.
  if (live) {
    const headY = middle - Math.min(1, samples[SAMPLE_COUNT - 1]) * (middle - 2);
    context.beginPath();
    context.arc(width - 1, headY, 2.4, 0, Math.PI * 2);
    context.fillStyle = accent;
    context.fill();
  }
};

const frame = (): void => {
  if (!running) return;

  if (live) {
    push(currentLevel);
    // Decay towards silence between frames so a held level does not flatline.
    currentLevel *= 0.82;
  } else {
    idlePhase += 0.045;
    // A slow travelling ripple: awake, not listening.
    push(0.035 + Math.sin(idlePhase) * 0.025 + Math.sin(idlePhase * 2.3) * 0.012);
  }

  draw();
  requestAnimationFrame(frame);
};

const start = (): void => {
  if (running) return;
  running = true;
  requestAnimationFrame(frame);
};

const stop = (): void => {
  running = false;
  samples.fill(0);
  draw();
};

window.addEventListener('resize', resize);
resize();

window.voiceCaptionAPI.onCaption((event) => {
  accent = event.accent || '#c4123f';
  document.body.style.setProperty('--accent', accent);

  card.classList.toggle('shown', event.stage !== 'off');
  stageLabel.textContent = event.stageLabel;
  // The notice replaces the hint rather than the stage: on the strip there is
  // room for both, and "waking the model" is exactly the sort of thing the hint
  // slot is for.
  hint.textContent = event.notice || event.hint;
  transcript.textContent = event.transcript;
  transcript.dataset.placeholder = event.placeholder;

  live = event.stage === 'hearing';
  if (live) currentLevel = Math.max(currentLevel, event.level);

  if (event.stage === 'off') {
    stop();
    return;
  }
  resize();
  start();
});
