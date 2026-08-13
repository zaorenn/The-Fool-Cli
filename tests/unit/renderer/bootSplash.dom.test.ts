/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissBootSplash } from '@renderer/utils/bootSplash';

/**
 * The splash covers the whole viewport at z-index 9999. Whether it is removed
 * decides whether the user sees the app or a frozen logo, so these tests are
 * about one question: does it always go away?
 */

const SPLASH_MARKUP = '<div id="boot-splash"></div>';

/** Runs the queued animation frame callbacks, newest chain first. */
function flushAnimationFrames(times = 2): void {
  for (let i = 0; i < times; i += 1) {
    vi.advanceTimersByTime(16);
  }
}

describe('dismissBootSplash', () => {
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = SPLASH_MARKUP;
    rafCallbacks = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  /** A window that paints: frame callbacks run on the next tick. */
  function withWorkingAnimationFrames(): void {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = setTimeout(() => callback(performance.now()), 16);
      return id as unknown as number;
    });
  }

  /**
   * A window that is not producing frames — minimised, occluded, on another
   * virtual desktop, or a background browser tab. Callbacks are accepted and
   * never run, which is exactly what browsers do.
   */
  function withFrozenAnimationFrames(): void {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
  }

  it('removes the splash once two frames have painted', () => {
    withWorkingAnimationFrames();

    dismissBootSplash();
    flushAnimationFrames();
    vi.advanceTimersByTime(600);

    expect(document.getElementById('boot-splash')).toBeNull();
  });

  it('marks the splash as leaving so the fade runs', () => {
    withWorkingAnimationFrames();

    dismissBootSplash();
    flushAnimationFrames();

    expect(document.getElementById('boot-splash')?.className).toContain('boot-splash--leaving');
  });

  it('removes the splash even when no frame is ever painted', () => {
    withFrozenAnimationFrames();

    dismissBootSplash();
    vi.advanceTimersByTime(2000);

    // The window never composited, so neither frame callback ran.
    expect(rafCallbacks).toHaveLength(1);
    expect(document.getElementById('boot-splash')).toBeNull();
  });

  it('removes the splash only once when frames resume after the fallback', () => {
    withFrozenAnimationFrames();

    dismissBootSplash();
    vi.advanceTimersByTime(2000);
    // The window is shown again and the queued frame callbacks finally run.
    expect(() => rafCallbacks.forEach((callback) => callback(0))).not.toThrow();

    expect(document.getElementById('boot-splash')).toBeNull();
  });

  it('does nothing when the document carries no splash', () => {
    withWorkingAnimationFrames();
    document.body.innerHTML = '';

    expect(() => dismissBootSplash()).not.toThrow();
  });
});
