/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { findWakePhrase, matchesWakePhrase } from '@renderer/services/voice/wakePhrase';

const PHRASE = 'wake up fool';

describe('matchesWakePhrase', () => {
  it('matches the phrase on its own', () => {
    expect(matchesWakePhrase('wake up fool', PHRASE)).toBe(true);
  });

  it('matches the phrase inside a longer sentence', () => {
    expect(matchesWakePhrase('so anyway wake up fool and read me the diff', PHRASE)).toBe(true);
  });

  it('ignores case, punctuation and surrounding noise', () => {
    expect(matchesWakePhrase('  Hey — WAKE UP, Fool!  ', PHRASE)).toBe(true);
  });

  it('matches when the recogniser runs the words together', () => {
    expect(matchesWakePhrase('wakeupfool', PHRASE)).toBe(true);
  });

  it('tolerates one wrong letter in a long word', () => {
    expect(matchesWakePhrase('wake up fools', PHRASE)).toBe(true);
    expect(matchesWakePhrase('wale up fool', PHRASE)).toBe(true);
  });

  it('refuses text that only shares some of the words', () => {
    expect(matchesWakePhrase('wake me up in an hour', PHRASE)).toBe(false);
    expect(matchesWakePhrase('what a fool', PHRASE)).toBe(false);
  });

  it('refuses the right words in the wrong order', () => {
    expect(matchesWakePhrase('fool up wake', PHRASE)).toBe(false);
  });

  it('requires the words to be adjacent', () => {
    expect(matchesWakePhrase('wake me up because I am a fool', PHRASE)).toBe(false);
  });

  it('handles Turkish letters in a phrase and in speech', () => {
    expect(matchesWakePhrase('hadi uyan şapşal bakalım', 'uyan şapşal')).toBe(true);
    expect(matchesWakePhrase('HADİ UYAN ŞAPŞAL', 'uyan şapşal')).toBe(true);
  });

  it('treats empty input as no match', () => {
    expect(matchesWakePhrase('', PHRASE)).toBe(false);
    expect(matchesWakePhrase('wake up fool', '')).toBe(false);
    expect(matchesWakePhrase('wake up fool', '   ')).toBe(false);
  });

  it('does not fire on a single short word phrase buried in noise', () => {
    // Short phrases have no edit tolerance, so near misses stay silent.
    expect(matchesWakePhrase('gool', 'fool')).toBe(false);
    expect(matchesWakePhrase('fool', 'fool')).toBe(true);
  });
});

describe('findWakePhrase', () => {
  it('hands back the instruction said in the same breath', () => {
    expect(findWakePhrase('wake up fool, run the tests', PHRASE)).toEqual({ commandText: 'run the tests' });
  });

  it('hands back nothing when the phrase was said alone', () => {
    expect(findWakePhrase('wake up fool', PHRASE)).toEqual({ commandText: '' });
  });

  it('ignores words spoken before the phrase', () => {
    expect(findWakePhrase('okay so wake up fool and stop', PHRASE)).toEqual({ commandText: 'and stop' });
  });

  it('has no command to offer when the words arrived joined together', () => {
    expect(findWakePhrase('wakeupfool', PHRASE)).toEqual({ commandText: '' });
  });

  it('is null when the phrase is absent', () => {
    expect(findWakePhrase('nothing to see here', PHRASE)).toBeNull();
  });
});
