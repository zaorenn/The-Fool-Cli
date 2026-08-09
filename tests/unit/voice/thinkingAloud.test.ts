/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  FIRST_GAP_MS,
  MAX_FILLERS,
  VARIANTS_PER_KIND,
  fillerFor,
  fillerKey,
  gapBefore,
  type ThinkingState,
} from '@/common/voice/thinkingAloud';

const state = (over: Partial<ThinkingState> = {}): ThinkingState => ({
  elapsedMs: 0,
  quietForMs: 0,
  speaking: false,
  toolsRan: 0,
  saidSoFar: 0,
  ...over,
});

describe('when to say something into a silence', () => {
  it('leaves a short pause alone', () => {
    expect(fillerFor(state({ quietForMs: FIRST_GAP_MS - 1 }))).toBeNull();
  });

  it('fills the first long one', () => {
    expect(fillerFor(state({ quietForMs: FIRST_GAP_MS }))).toBe('thinking');
  });

  /// A filler over the top of an answer is worse than any silence it could
  /// have covered.
  it('never speaks over real speech', () => {
    expect(fillerFor(state({ quietForMs: 60_000, speaking: true }))).toBeNull();
  });

  it('stops rather than nagging', () => {
    expect(fillerFor(state({ quietForMs: 600_000, saidSoFar: MAX_FILLERS }))).toBeNull();
  });

  it('waits longer each time', () => {
    expect(gapBefore(0)).toBe(FIRST_GAP_MS);
    expect(gapBefore(1)).toBeGreaterThan(gapBefore(0));
    expect(gapBefore(2)).toBeGreaterThan(gapBefore(1));
    expect(gapBefore(3)).toBeGreaterThan(gapBefore(2));
  });

  it('does not fill the second gap at the first gap’s length', () => {
    expect(fillerFor(state({ quietForMs: FIRST_GAP_MS + 100, saidSoFar: 1 }))).toBeNull();
    expect(fillerFor(state({ quietForMs: gapBefore(1), saidSoFar: 1, toolsRan: 1 }))).toBe('working');
  });
});

describe('what it says', () => {
  /// Before anything has happened there is nothing true to report, so it is a
  /// sound rather than a sentence.
  it('is a sound before any tool has run', () => {
    expect(fillerFor(state({ quietForMs: FIRST_GAP_MS, toolsRan: 0 }))).toBe('thinking');
  });

  it('is about the work once there is work', () => {
    expect(fillerFor(state({ quietForMs: FIRST_GAP_MS, toolsRan: 2 }))).toBe('working');
  });

  it('admits it is taking a while once it is', () => {
    expect(fillerFor(state({ quietForMs: gapBefore(1), saidSoFar: 1, toolsRan: 2, elapsedMs: 45_000 }))).toBe('still');
  });
});

describe('which line', () => {
  /// The same sentence three times is worse than silence — it is what a
  /// machine sounds like.
  it('cycles through the variants rather than repeating one', () => {
    const keys = [0, 1, 2].map((n) => fillerKey('thinking', n));
    expect(new Set(keys).size).toBe(VARIANTS_PER_KIND);
  });

  it('comes back round after the last variant', () => {
    expect(fillerKey('working', VARIANTS_PER_KIND)).toBe(fillerKey('working', 0));
  });

  it('names a key under the voice settings, where the rest of the spoken lines are', () => {
    expect(fillerKey('still', 0)).toBe('settings.voice.thinkingAloud.still.0');
  });
});
