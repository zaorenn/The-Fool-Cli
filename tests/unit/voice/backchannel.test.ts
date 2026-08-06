/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isBackchannel } from '@/common/voice/backchannel';

/**
 * "Carry on" against "stop", which is the difference between an assistant that
 * finishes a sentence and one that never answers at all.
 *
 * People say "mhm" and "evet" while someone else is talking. Treating that as
 * taking the floor meant the reply was abandoned and the app then tried to answer
 * "mhm" — so the user heard nothing and saw nothing, which is exactly how this
 * was reported: "even when it hears me it does not reply."
 */
describe('isBackchannel', () => {
  it('recognises the sounds people make while listening', () => {
    for (const text of ['mhm', 'hmm', 'hıhı', 'ıhı', 'uh huh', 'mm']) {
      expect(isBackchannel(text)).toBe(true);
    }
  });

  it('recognises short agreement in Turkish and English', () => {
    for (const text of ['evet', 'tamam', 'anladım', 'aynen', 'peki', 'yeah', 'ok', 'right', 'got it']) {
      expect(isBackchannel(text)).toBe(true);
    }
  });

  it('ignores the punctuation and capitals a transcriber adds', () => {
    expect(isBackchannel('Evet.')).toBe(true);
    expect(isBackchannel('  Tamam!  ')).toBe(true);
    expect(isBackchannel('EVET')).toBe(true);
    // Turkish casing: a dotted capital İ lowercases to i, not to ı.
    expect(isBackchannel('Anladım')).toBe(true);
  });

  it('allows a couple of acknowledgements together', () => {
    expect(isBackchannel('evet tamam')).toBe(true);
    expect(isBackchannel('tamam anladım')).toBe(true);
    expect(isBackchannel('yeah ok sure')).toBe(true);
  });

  it('treats anything with a request in it as a turn', () => {
    for (const text of [
      'evet ama bunu değiştir',
      'tamam şimdi Discord’u aç',
      'anladım, peki ekranıma bakar mısın',
      'ok stop',
      'hayır',
      'bir saniye',
      'evet evet evet evet',
    ]) {
      expect(isBackchannel(text)).toBe(false);
    }
  });

  it('does not treat silence as agreement', () => {
    // An empty transcript is a failure to hear, and the two want different
    // handling: one carries on quietly, the other has to be said out loud.
    expect(isBackchannel('')).toBe(false);
    expect(isBackchannel('   ')).toBe(false);
    expect(isBackchannel('...')).toBe(false);
  });
});
