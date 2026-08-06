/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { refersToScreen } from '@/common/voice/screenIntent';

/**
 * Noticing that a question is about a screen, before the model is asked.
 *
 * The measured failure this exists for: asked about something on screen without
 * the word "screen" in the sentence, the model answered from nothing — and
 * confidently, which is what makes it damaging. A false negative here costs a
 * turn; a false positive costs a screenshot and several seconds of silence, so
 * the ordinary-conversation cases below matter as much as the screen ones.
 */

describe('refersToScreen', () => {
  it('sees a screen named outright', () => {
    expect(refersToScreen('look at my screen and tell me what you see')).toBe(true);
    expect(refersToScreen('ekranıma bak')).toBe(true);
    expect(refersToScreen('ekranima bak ve ne gorduğunu anlat')).toBe(true);
  });

  it('sees the question people actually ask, which never says screen', () => {
    expect(refersToScreen('what does this error mean')).toBe(true);
    expect(refersToScreen('bu hata ne demek')).toBe(true);
    expect(refersToScreen('what does it say here')).toBe(true);
    expect(refersToScreen('burada ne yazıyor')).toBe(true);
    expect(refersToScreen('şuna bir bak')).toBe(true);
  });

  it('sees being asked what is visible', () => {
    expect(refersToScreen('what do you see')).toBe(true);
    expect(refersToScreen('ne görüyorsun')).toBe(true);
  });

  it('reads Turkish written without its diacritics, which is how it arrives', () => {
    expect(refersToScreen('bu hatayi nasil duzeltirim, ne yaziyor')).toBe(true);
    expect(refersToScreen('su pencere ne gosteriyor')).toBe(true);
  });

  it('leaves ordinary conversation alone', () => {
    expect(refersToScreen('what is the weather like today')).toBe(false);
    expect(refersToScreen('bugün hava nasıl')).toBe(false);
    expect(refersToScreen('tell me a joke')).toBe(false);
    expect(refersToScreen('bir şarkı aç')).toBe(false);
    expect(refersToScreen('remember that I am called Serhan')).toBe(false);
  });

  it('does not fire on a pointing word by itself, which is most of speech', () => {
    expect(refersToScreen('this is great')).toBe(false);
    expect(refersToScreen('bu çok güzel')).toBe(false);
    expect(refersToScreen('I like that a lot')).toBe(false);
  });

  it('does not match a pointing word buried inside another one', () => {
    expect(refersToScreen('the situation with the error is unclear')).toBe(false);
  });

  it('says no to nothing at all', () => {
    expect(refersToScreen('')).toBe(false);
    expect(refersToScreen('   ')).toBe(false);
  });
});
