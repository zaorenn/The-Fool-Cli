/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { clampRect, cropForSelection, MINIMUM_SELECTION_PX, rectFromDrag } from '@process/voice/selectionGeometry';

describe('rectFromDrag', () => {
  it('reads a drag down and to the right', () => {
    expect(rectFromDrag({ startX: 10, startY: 20, endX: 110, endY: 70 })).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  it('reads a drag up and to the left as the same rectangle', () => {
    expect(rectFromDrag({ startX: 110, startY: 70, endX: 10, endY: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  it('gives a click no area rather than a negative one', () => {
    expect(rectFromDrag({ startX: 40, startY: 40, endX: 40, endY: 40 })).toEqual({
      x: 40,
      y: 40,
      width: 0,
      height: 0,
    });
  });
});

describe('clampRect', () => {
  it('leaves a rectangle that already fits alone', () => {
    const rect = { x: 10, y: 10, width: 100, height: 100 };
    expect(clampRect(rect, { width: 800, height: 600 })).toEqual(rect);
  });

  it('trims a rectangle that runs off the far edge', () => {
    expect(clampRect({ x: 700, y: 500, width: 400, height: 400 }, { width: 800, height: 600 })).toEqual({
      x: 700,
      y: 500,
      width: 100,
      height: 100,
    });
  });

  it('trims a rectangle that starts before the origin', () => {
    expect(clampRect({ x: -50, y: -20, width: 100, height: 100 }, { width: 800, height: 600 })).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 80,
    });
  });

  it('collapses a rectangle that is entirely outside', () => {
    expect(clampRect({ x: 900, y: 700, width: 100, height: 100 }, { width: 800, height: 600 })).toEqual({
      x: 800,
      y: 600,
      width: 0,
      height: 0,
    });
  });
});

describe('cropForSelection', () => {
  const display = { width: 1920, height: 1080 };

  it('passes a selection through unchanged when the capture matches the display', () => {
    expect(cropForSelection({ x: 100, y: 50, width: 400, height: 300 }, display, display)).toEqual({
      x: 100,
      y: 50,
      width: 400,
      height: 300,
    });
  });

  it('scales the selection up to a 150% display capture', () => {
    const capture = { width: 2880, height: 1620 };

    expect(cropForSelection({ x: 100, y: 50, width: 400, height: 300 }, display, capture)).toEqual({
      x: 150,
      y: 75,
      width: 600,
      height: 450,
    });
  });

  it('covers every pixel dragged over when the scale does not divide evenly', () => {
    const capture = { width: 2880, height: 1620 };

    const crop = cropForSelection({ x: 101, y: 51, width: 401, height: 301 }, display, capture);

    // 101 * 1.5 = 151.5 → the origin floors so the first row is not shaved off,
    // and the far edge (502 * 1.5 = 753) ceils so the last one is not either.
    expect(crop).toEqual({ x: 151, y: 76, width: 602, height: 452 });
  });

  it('scales down when the capture is smaller than the display', () => {
    const capture = { width: 960, height: 540 };

    expect(cropForSelection({ x: 200, y: 100, width: 400, height: 200 }, display, capture)).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 100,
    });
  });

  it('trims a selection dragged past the edge of the display', () => {
    expect(cropForSelection({ x: 1800, y: 1000, width: 400, height: 400 }, display, display)).toEqual({
      x: 1800,
      y: 1000,
      width: 120,
      height: 80,
    });
  });

  it('refuses a selection smaller than the minimum in either direction', () => {
    const tooNarrow = { x: 10, y: 10, width: MINIMUM_SELECTION_PX - 1, height: 200 };
    const tooShort = { x: 10, y: 10, width: 200, height: MINIMUM_SELECTION_PX - 1 };

    expect(cropForSelection(tooNarrow, display, display)).toBeNull();
    expect(cropForSelection(tooShort, display, display)).toBeNull();
  });

  it('accepts a selection exactly at the minimum', () => {
    const smallest = { x: 10, y: 10, width: MINIMUM_SELECTION_PX, height: MINIMUM_SELECTION_PX };

    expect(cropForSelection(smallest, display, display)).toEqual(smallest);
  });

  it('refuses a selection dragged entirely off the display', () => {
    expect(cropForSelection({ x: 5000, y: 5000, width: 200, height: 200 }, display, display)).toBeNull();
  });

  it('refuses to crop when the capture has no size', () => {
    expect(cropForSelection({ x: 10, y: 10, width: 200, height: 200 }, display, { width: 0, height: 0 })).toBeNull();
  });

  it('refuses to crop when the display has no size', () => {
    expect(cropForSelection({ x: 10, y: 10, width: 200, height: 200 }, { width: 0, height: 0 }, display)).toBeNull();
  });
});
