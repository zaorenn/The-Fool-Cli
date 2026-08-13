/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { toSpeakableText } from '@process/services/fool-voice/audiocpp/speakableText';

/**
 * Every expectation here was measured against a running audio.cpp server
 * (release-0.5, CUDA, supertonic) rather than assumed. The engine answers 500
 * for a codepoint it cannot index, so the sentence is never spoken at all.
 */
describe('toSpeakableText', () => {
  it('replaces the ellipsis the engine has no index entry for', () => {
    expect(toSpeakableText('Bir saniye…')).toBe('Bir saniye...');
  });

  it('replaces every ellipsis in a sentence, not only the first', () => {
    expect(toSpeakableText('Hmm… well… maybe.')).toBe('Hmm... well... maybe.');
  });

  /**
   * The temptation on seeing this bug is to fold the text to ASCII. That would
   * silently mangle the language the assistant speaks most here.
   */
  it('leaves Turkish letters exactly as they are', () => {
    const turkish = 'Günaydın, nasılsın? Çok şığ bir öğle.';
    expect(toSpeakableText(turkish)).toBe(turkish);
  });

  /**
   * Curly quotes, apostrophes and em dashes were each probed and each returned
   * 200 — replacing them would be churn dressed up as a fix.
   */
  it('leaves the punctuation the engine already accepts alone', () => {
    const punctuation = 'It’s an “example” — really.';
    expect(toSpeakableText(punctuation)).toBe(punctuation);
  });

  it('passes plain text through unchanged', () => {
    expect(toSpeakableText('Hello there.')).toBe('Hello there.');
    expect(toSpeakableText('')).toBe('');
  });
});
