/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  ASIDE_NAME_MAX,
  BETWEEN_ASIDES_MS,
  FIRST_GAP_MS,
  MAX_FILLERS,
  QUIET_BEFORE_ASIDE_MS,
  VARIANTS_PER_KIND,
  fillerFor,
  fillerKey,
  gapBefore,
  mayMentionAside,
  shortenForAside,
  type AsideMoment,
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

/**
 * An aside is an interruption, so it owes the room more than a filler does.
 *
 * A filler covers a silence the assistant itself made. This walks into one
 * nobody asked it to fill, which is why every one of these is a refusal.
 */
const moment = (over: Partial<AsideMoment> = {}): AsideMoment => ({
  phase: 'listening',
  standby: false,
  quietForMs: QUIET_BEFORE_ASIDE_MS,
  sinceLastAsideMs: Number.POSITIVE_INFINITY,
  ...over,
});

describe('mentioning a finished task', () => {
  it('takes a long enough gap in a listening conversation', () => {
    expect(mayMentionAside(moment())).toBe(true);
  });

  it('refuses over an answer', () => {
    expect(mayMentionAside(moment({ phase: 'speaking' }))).toBe(false);
  });

  it('refuses over the user', () => {
    expect(mayMentionAside(moment({ phase: 'hearing' }))).toBe(false);
  });

  it('refuses while it has been told to wait', () => {
    expect(mayMentionAside(moment({ standby: true }))).toBe(false);
  });

  it('refuses in a pause too short to walk into', () => {
    expect(mayMentionAside(moment({ quietForMs: QUIET_BEFORE_ASIDE_MS - 1 }))).toBe(false);
  });

  /// Two tasks finishing while a third is discussed is the normal case once
  /// delegating is cheap, and back to back they are one unreadable sentence.
  it('refuses on top of the previous aside', () => {
    expect(mayMentionAside(moment({ sinceLastAsideMs: BETWEEN_ASIDES_MS - 1 }))).toBe(false);
    expect(mayMentionAside(moment({ sinceLastAsideMs: BETWEEN_ASIDES_MS }))).toBe(true);
  });
});

describe('naming the task that finished', () => {
  it('leaves a short request alone', () => {
    expect(shortenForAside('back up the photos')).toBe('back up the photos');
  });

  it('collapses the whitespace a transcript arrives with', () => {
    expect(shortenForAside('back  up\n the photos')).toBe('back up the photos');
  });

  /// Read back in full, a long request is not a reminder — it is the task
  /// again, and by then the user has stopped listening.
  it('shortens a long one at a word boundary', () => {
    const long = 'open Discord and tell Ali I am running twenty minutes late and will bring the drive';
    const short = shortenForAside(long);
    expect(short.length).toBeLessThanOrEqual(ASIDE_NAME_MAX + 1);
    expect(short.endsWith('…')).toBe(true);
    expect(long.startsWith(short.slice(0, -1))).toBe(true);
  });
});
