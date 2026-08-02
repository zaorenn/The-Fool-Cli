/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { MINIMUM_SELECTION_PX, rectFromDrag, type Rect } from '@process/voice/selectionGeometry';

/**
 * Draws the selection while it is being dragged.
 *
 * Dependency-free for the same reason as Fool's Control: this window is one
 * rectangle and a hint, and React would cost more than it explains. The
 * arithmetic it does share is imported rather than rewritten — a box drawn by
 * one rule and cropped by another is a bug the user sees as "it captured the
 * wrong part of the screen".
 *
 * Every way out reports exactly once. Escape, a right-click and a click with no
 * drag all report nothing, which the main process reads as "no region".
 */

declare global {
  interface Window {
    regionSelectAPI: {
      done: (selection: Rect | null) => void;
    };
  }
}

const box = document.getElementById('box') as HTMLDivElement;
const size = document.getElementById('size') as HTMLSpanElement;
const hint = document.getElementById('hint') as HTMLDivElement;

/**
 * Already translated, and passed in on the URL.
 *
 * This window has no i18n runtime — the main process owns the app's language
 * and does the lookup before the window is loaded, the same arrangement Fool's
 * Control uses for its labels.
 */
hint.textContent = new URLSearchParams(window.location.search).get('hint') ?? '';

let origin: { x: number; y: number } | null = null;
let answered = false;

/** The one exit. Called from every path so a second one cannot report again. */
const answer = (selection: Rect | null): void => {
  if (answered) return;
  answered = true;
  window.regionSelectAPI.done(selection);
};

const paint = (rect: Rect): void => {
  box.style.left = `${rect.x}px`;
  box.style.top = `${rect.y}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
  size.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  // The readout sits above the box; against the top of the screen there is no
  // room for it there, so it moves inside.
  box.classList.toggle('near-top', rect.y < 30);
};

document.addEventListener('mousedown', (event) => {
  // Anything but the left button is a way out, not a way in: a right-click
  // during a selection is how people cancel things.
  if (event.button !== 0) {
    answer(null);
    return;
  }
  origin = { x: event.clientX, y: event.clientY };
  hint.classList.add('gone');
  box.classList.add('drawing');
  paint({ x: event.clientX, y: event.clientY, width: 0, height: 0 });
});

document.addEventListener('mousemove', (event) => {
  if (!origin) return;
  paint(rectFromDrag({ startX: origin.x, startY: origin.y, endX: event.clientX, endY: event.clientY }));
});

document.addEventListener('mouseup', (event) => {
  if (!origin) return;
  const rect = rectFromDrag({ startX: origin.x, startY: origin.y, endX: event.clientX, endY: event.clientY });
  origin = null;
  // A click that never became a drag is someone dismissing the overlay, not
  // someone asking for an eight-pixel screenshot.
  answer(rect.width >= MINIMUM_SELECTION_PX && rect.height >= MINIMUM_SELECTION_PX ? rect : null);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') answer(null);
});

// Losing the window mid-drag has to end the selection too, or the overlay sits
// there invisible over a screen the user has moved on from.
window.addEventListener('blur', () => answer(null));
