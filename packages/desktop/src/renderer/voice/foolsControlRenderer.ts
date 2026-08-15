/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { MAX_NOTCH_CHOICE_KEYS, type FoolsControlPayload, type VoiceStageEvent } from '@/common/types/voiceStage';

/**
 * Draws Fool's Control.
 *
 * Deliberately dependency-free: this window is one notch, and pulling React and
 * the i18n runtime into a second renderer to draw a waveform and a few lines
 * would cost more than it explains. Labels arrive already translated from the
 * main window, which owns the language.
 *
 * The waveform is a real oscilloscope, not decoration: every frame it appends the
 * microphone's current level to a ring buffer and redraws the whole trace, so the
 * shape on screen is the shape of what was said a moment ago, scrolling away to
 * the left. Between utterances the trace relaxes to a slow travelling ripple
 * rather than stopping dead.
 *
 * The notch has two sizes and picks between them from the event alone: collapsed
 * while it is only listening, expanded once there is a sentence or something
 * being done about one. Nothing here decides *when* to appear — the main process
 * owns that.
 */

declare global {
  interface Window {
    foolsControlAPI: {
      onStage: (callback: (event: FoolsControlPayload) => void) => () => void;
      onPointer: (callback: (over: boolean) => void) => () => void;
      reportBounds: (bounds: { x: number; y: number; width: number; height: number }) => void;
    };
  }
}

const notch = document.getElementById('notch') as HTMLDivElement;
const stageLabel = document.getElementById('stage') as HTMLSpanElement;
const hint = document.getElementById('hint') as HTMLSpanElement;
const canvas = document.getElementById('wave') as HTMLCanvasElement;
const transcript = document.getElementById('transcript') as HTMLDivElement;
const reply = document.getElementById('reply') as HTMLDivElement;
const activity = document.getElementById('activity') as HTMLDivElement;
const ask = document.getElementById('ask') as HTMLDivElement;
const askTitle = document.getElementById('ask-title') as HTMLDivElement;
const askOptions = document.getElementById('ask-options') as HTMLDivElement;
const askHint = document.getElementById('ask-hint') as HTMLDivElement;
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

/**
 * Rebuilt from the event rather than appended to.
 *
 * The event carries the whole list every time, so the notch cannot drift out of
 * step with the turn — a line dropped upstream disappears here too, which an
 * append-only log could not do.
 */
const renderActivity = (lines: VoiceStageEvent['activity']): void => {
  activity.replaceChildren(
    ...lines.map((line) => {
      const row = document.createElement('div');
      row.className = line.done ? 'act done' : 'act';
      row.textContent = line.text;
      return row;
    })
  );
};

/**
 * The question the agent is waiting on, and how to answer it without looking.
 *
 * Only the first few options get a number: the keys are pressed while looking at
 * something else, and past three the numbering asks more of the reader than the
 * shortcut is worth. The rest are still listed — they exist, they just have to be
 * clicked in the app.
 */
const renderAsk = (request: FoolsControlPayload['permission']): void => {
  if (!request) {
    askOptions.replaceChildren();
    return;
  }
  askTitle.textContent = request.title;
  askHint.textContent = request.hint;
  askOptions.replaceChildren(
    ...request.options.map((label, index) => {
      const numbered = index < MAX_NOTCH_CHOICE_KEYS;
      const row = document.createElement('div');
      row.className = numbered ? 'opt' : 'opt bare';
      if (numbered) {
        const key = document.createElement('span');
        key.className = 'optkey';
        key.textContent = String(index + 1);
        row.append(key);
      }
      const text = document.createElement('span');
      text.textContent = label;
      row.append(text);
      return row;
    })
  );
};

window.foolsControlAPI.onStage((event) => {
  accent = event.accent || '#c4123f';
  document.body.style.setProperty('--accent', accent);

  const request = event.permission ?? null;
  notch.classList.toggle('shown', event.stage !== 'off' || Boolean(request));
  // Expanded once there is something to read. Waiting for the wake phrase is
  // just the pill: there is nothing to say yet, and a wide notch sitting open
  // over the user's screen for no reason is worse than a small one.
  const activityLines = event.activity ?? [];
  const replyText = event.reply ?? '';
  notch.classList.toggle(
    'wide',
    event.transcript.length > 0 || replyText.length > 0 || activityLines.length > 0 || Boolean(request)
  );
  notch.classList.toggle('asking', Boolean(request));
  renderAsk(request);

  stageLabel.textContent = event.stageLabel;
  // The notice replaces the hint rather than the stage: there is room for both,
  // and "waking the model" is exactly the sort of thing the hint slot is for.
  hint.textContent = event.notice || event.hint;
  transcript.textContent = event.transcript;
  transcript.dataset.placeholder = event.placeholder;
  reply.textContent = replyText;
  renderActivity(activityLines);

  live = event.stage === 'hearing';
  if (live) currentLevel = Math.max(currentLevel, event.level);

  // A question outlives the turn that led to it, and a notch showing one with a
  // dead flat trace reads as a window that has crashed.
  if (event.stage === 'off' && !request) {
    stop();
    return;
  }
  resize();
  start();
});

window.addEventListener('resize', resize);
resize();

/**
 * Gets out of the way of the pointer.
 *
 * The notch sits over the top of whatever is underneath it, and the one moment
 * the user needs to see through it is the moment they move the cursor there — a
 * tab strip, a menu bar, a close button. It cannot be clicked through to, so
 * fading is the whole of the interaction.
 *
 * **The decision is not made here.** It used to be, from mouse events the window
 * forwards while ignoring the mouse, and that was wrong twice over. The
 * listener was on the window, which is a fixed 680×280 box sized for the widest
 * state the notch ever reaches — so moving the cursor anywhere in that region
 * faded a pill it was nowhere near. And the forwarded stream simply stops when
 * the pointer leaves, with no closing event to match the opening one, so a notch
 * that had faded could stay faded for good with nothing able to bring it back.
 *
 * The main process reads the system cursor instead, which is true wherever the
 * pointer is and cannot stop arriving. All this window has to do is say where it
 * drew itself.
 */
window.foolsControlAPI.onPointer((over) => {
  notch.classList.toggle('under-pointer', over);
});

/**
 * Tells the main process where the notch actually is.
 *
 * Only on a change, and there are few: the notch has two widths and moves
 * between them when the turn produces something to read. Measured after a frame
 * so the transition has a layout to report rather than the one it started from.
 */
let reportedBounds = '';
const reportBounds = (): void => {
  const box = notch.getBoundingClientRect();
  const bounds = { x: box.left, y: box.top, width: box.width, height: box.height };
  const signature = `${bounds.x}|${bounds.y}|${bounds.width}|${bounds.height}`;
  if (signature === reportedBounds) return;
  reportedBounds = signature;
  window.foolsControlAPI.reportBounds(bounds);
};

/**
 * Watched rather than reported once per event.
 *
 * The width is a 340 ms CSS transition, so the size at the moment the event
 * arrives is the size it is leaving — and a rectangle that is wrong for a third
 * of a second is a notch that fades in the wrong place for a third of a second.
 * A resize observer sees every intermediate layout, which is exactly the set of
 * moments this has to be right at.
 */
new ResizeObserver(reportBounds).observe(notch);
window.addEventListener('resize', reportBounds);
requestAnimationFrame(reportBounds);
