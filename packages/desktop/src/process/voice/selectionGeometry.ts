/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turning a drag into a crop.
 *
 * Two coordinate spaces meet here and neither is obviously wrong, which is why
 * this is a separate file with tests rather than a few lines inside the window.
 * The user drags in the selection window's CSS pixels, which are the display's
 * own logical coordinates. `desktopCapturer` hands back an image in *physical*
 * pixels — on a 150% display that is 1.5× larger in each direction, and a crop
 * taken with the raw drag numbers would quietly capture the top-left corner of
 * what was pointed at.
 *
 * Nothing here touches Electron, so every rule below — direction, clamping,
 * scaling, the minimum size — is checked without a screen.
 */

/** A rectangle in whichever space its producer used. Never negative. */
export type Rect = { x: number; y: number; width: number; height: number };

/** Where a drag started and where it ended, in the selection window's pixels. */
export type Drag = { startX: number; startY: number; endX: number; endY: number };

/**
 * Below this the selection is treated as a click, not a drag.
 *
 * A click that becomes a 2×3 pixel crop is never what was meant, and sending it
 * to a model costs a turn to find that out.
 */
export const MINIMUM_SELECTION_PX = 8;

/**
 * The drag as a rectangle, in the space it was drawn in.
 *
 * Dragging up and to the left is as ordinary as dragging down and to the right,
 * so the corners are ordered rather than assumed.
 */
export const rectFromDrag = (drag: Drag): Rect => ({
  x: Math.min(drag.startX, drag.endX),
  y: Math.min(drag.startY, drag.endY),
  width: Math.abs(drag.endX - drag.startX),
  height: Math.abs(drag.endY - drag.startY),
});

/** Trims a rectangle to the bounds it has to live inside. */
export const clampRect = (rect: Rect, within: { width: number; height: number }): Rect => {
  const left = Math.max(0, Math.min(rect.x, within.width));
  const top = Math.max(0, Math.min(rect.y, within.height));
  const right = Math.max(left, Math.min(rect.x + rect.width, within.width));
  const bottom = Math.max(top, Math.min(rect.y + rect.height, within.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/**
 * A selection in logical pixels, as a crop in the captured image's pixels.
 *
 * Returns null for anything that is not a usable crop: a click rather than a
 * drag, a selection dragged entirely off the display, or a capture whose size
 * is not known. Null means "capture the whole screen instead" to every caller,
 * which is the right answer for all three.
 */
export const cropForSelection = (
  selection: Rect,
  display: { width: number; height: number },
  capture: { width: number; height: number }
): Rect | null => {
  if (display.width <= 0 || display.height <= 0) return null;
  if (capture.width <= 0 || capture.height <= 0) return null;

  const bounded = clampRect(selection, display);
  if (bounded.width < MINIMUM_SELECTION_PX || bounded.height < MINIMUM_SELECTION_PX) return null;

  const scaleX = capture.width / display.width;
  const scaleY = capture.height / display.height;

  // Floor the origin and ceil the far edge so the crop covers every pixel the
  // user drew over, rather than shaving a row off two sides through rounding.
  const x = Math.floor(bounded.x * scaleX);
  const y = Math.floor(bounded.y * scaleY);
  const right = Math.ceil((bounded.x + bounded.width) * scaleX);
  const bottom = Math.ceil((bounded.y + bounded.height) * scaleY);

  return clampRect({ x, y, width: right - x, height: bottom - y }, capture);
};
