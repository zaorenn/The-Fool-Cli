/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createIncrementalSentenceDetector } from '@renderer/services/voice/narration/incrementalSentences';

describe('createIncrementalSentenceDetector', () => {
  it('emits nothing until a sentence terminator arrives', () => {
    const detector = createIncrementalSentenceDetector();

    expect(detector.push('The answer is')).toEqual([]);
    expect(detector.push(' forty-two')).toEqual([]);
  });

  it('emits a sentence the moment its terminator arrives, across separate pushes', () => {
    const detector = createIncrementalSentenceDetector();

    detector.push('The answer is forty-');
    expect(detector.push('two. And that')).toEqual(['The answer is forty-two.']);
    expect(detector.push(' is final.')).toEqual(['And that is final.']);
  });

  it('emits more than one sentence from a single push when both complete at once', () => {
    const detector = createIncrementalSentenceDetector();

    expect(detector.push('First one. Second one. Third is unfinished')).toEqual(['First one.', 'Second one.']);
  });

  it('withholds text inside an unclosed code fence, however many sentence-like boundaries it contains', () => {
    const detector = createIncrementalSentenceDetector();

    expect(detector.push('Here is the fix. ```js\nif (x) { y(); } // done.\n')).toEqual(['Here is the fix.']);
    expect(detector.push('still going. ')).toEqual([]);

    // The closing fence releases everything after it back to sentence detection.
    expect(detector.push('```\nAnd that fixes it.')).toEqual([]);
    expect(detector.push(' done.')).toEqual(['And that fixes it.', 'done.']);
  });

  it('flush returns trailing text with no terminator, and nothing once already flushed', () => {
    const detector = createIncrementalSentenceDetector();
    detector.push('No ending here');

    expect(detector.flush()).toBe('No ending here');
    expect(detector.flush()).toBe('');
  });

  it('flush returns nothing extra when the buffer already ended cleanly', () => {
    const detector = createIncrementalSentenceDetector();
    detector.push('Done.');

    expect(detector.flush()).toBe('');
  });
});
