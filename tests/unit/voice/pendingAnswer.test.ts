/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { AwaitingAnswer, findUrl, foldTitle, titlesMatch } from '@/common/voice/pendingAnswer';

describe('findUrl', () => {
  it('finds an address in a sentence', () => {
    expect(findUrl('bu işte https://www.youtube.com/watch?v=abc123 al')).toBe('https://www.youtube.com/watch?v=abc123');
  });

  it('leaves the sentence’s punctuation out of the address', () => {
    expect(findUrl('şu: https://example.com/a.')).toBe('https://example.com/a');
    expect(findUrl('(https://example.com/b)')).toBe('https://example.com/b');
  });

  it('answers nothing when there is no address', () => {
    expect(findUrl('şarkının adı bunny girl')).toBeNull();
  });
});

describe('foldTitle', () => {
  it('folds Turkish letters, because the same title is written both ways', () => {
    // The application has already shipped one bug from assuming ASCII. This is
    // the place it would happen again.
    expect(foldTitle('Şarkı Adı')).toBe(foldTitle('Sarki Adi'));
    expect(foldTitle('İstanbul')).toBe(foldTitle('istanbul'));
  });

  it('ignores punctuation and case', () => {
    expect(foldTitle('Bunny Girl — Official Video!')).toBe('bunny girl official video');
  });
});

describe('titlesMatch', () => {
  it('accepts a page whose title contains what was seen', () => {
    expect(titlesMatch('bunny girl', 'Bunny Girl - Akasaki (Official Audio)')).toBe(true);
  });

  it('accepts two spellings of the same Turkish title', () => {
    expect(titlesMatch('Şarkı Adı', 'Sarki Adi - Resmi Video')).toBe(true);
  });

  it('refuses a page about something else', () => {
    expect(titlesMatch('bunny girl', 'How to file a tax return in 2026')).toBe(false);
  });

  it('refuses when either side is empty', () => {
    expect(titlesMatch('', 'anything')).toBe(false);
    expect(titlesMatch('anything', '')).toBe(false);
  });
});

describe('AwaitingAnswer', () => {
  it('offers nothing when nothing was asked', () => {
    // Not an inference: a stray address is only an answer when a question is
    // open. Guessing is how the wrong page becomes somebody's favourite song.
    const waiting = new AwaitingAnswer();
    expect(waiting.offer('https://example.com/x')).toEqual({ matched: false });
  });

  it('takes an address as the answer to the question it asked', () => {
    const waiting = new AwaitingAnswer();
    waiting.ask('bunny girl', 'favourite song');

    const attempt = waiting.offer('şu https://youtu.be/abc');
    expect(attempt.matched).toBe(true);
    expect(attempt.matched === true && attempt.url).toBe('https://youtu.be/abc');
    expect(attempt.matched === true && attempt.request.saveAs).toBe('favourite song');
  });

  it('answers a question only once', () => {
    const waiting = new AwaitingAnswer();
    waiting.ask('bunny girl', 'favourite song');
    waiting.offer('https://youtu.be/abc');

    expect(waiting.offer('https://youtu.be/def')).toEqual({ matched: false });
  });

  it('ignores something that is not an address', () => {
    const waiting = new AwaitingAnswer();
    waiting.ask('bunny girl', 'favourite song');

    expect(waiting.offer('evet o şarkı')).toEqual({ matched: false });
    // Still waiting: the question was not consumed by an answer that was not one.
    expect(waiting.pending()).not.toBeNull();
  });

  it('forgets a question nobody answered', () => {
    let now = 0;
    const waiting = new AwaitingAnswer(() => now);
    waiting.ask('bunny girl', 'favourite song');

    now = 11 * 60_000;
    // An address pasted an hour later, for a different reason, must not be
    // swallowed as the answer to a question nobody remembers being asked.
    expect(waiting.pending()).toBeNull();
    expect(waiting.offer('https://example.com/unrelated')).toEqual({ matched: false });
  });

  it('can be dropped when the user changes the subject', () => {
    const waiting = new AwaitingAnswer();
    waiting.ask('bunny girl', 'favourite song');
    waiting.clear();

    expect(waiting.pending()).toBeNull();
  });
});
