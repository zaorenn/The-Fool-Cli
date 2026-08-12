/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  deliberationFor,
  forgetRefusals,
  speaksOnlyToChat,
  mayAskForNoDeliberation,
  noDeliberation,
  NO_DELIBERATION,
  refusedTheField,
  rememberRefusal,
} from '@/common/realtime/reasoning';

/**
 * The four minutes before the first word.
 *
 * Measured on this machine: 273 seconds to the first spoken token, of which the
 * whole prompt accounted for 522 ms. The rest was the model deliberating into
 * `reasoning_content`, which the app rightly never reads aloud — so from the
 * room it was silence. One switch of ten stops it.
 */

describe('asking a model not to deliberate', () => {
  beforeEach(() => {
    forgetRefusals();
  });

  /// Nine other spellings were sent to the running server and ignored. This is
  /// the one it honoured, and getting it wrong is silent — a wrong field name
  /// costs four minutes a turn and produces no error at all.
  it('sends the one field the server actually honours', () => {
    expect(NO_DELIBERATION).toEqual({ reasoning_effort: 'none' });
    expect(noDeliberation('http://127.0.0.1:1234/v1')).toEqual({ reasoning_effort: 'none' });
  });

  it('asks by default, because most endpoints ignore what they do not know', () => {
    expect(mayAskForNoDeliberation('http://127.0.0.1:1234/v1')).toBe(true);
  });

  it('stops asking an endpoint that refused it', () => {
    rememberRefusal('http://strict.example/v1');

    expect(mayAskForNoDeliberation('http://strict.example/v1')).toBe(false);
    expect(noDeliberation('http://strict.example/v1')).toEqual({});
    // One endpoint objecting says nothing about another.
    expect(noDeliberation('http://127.0.0.1:1234/v1')).toEqual({ reasoning_effort: 'none' });
  });

  /**
   * Narrow on purpose. A 400 has many causes, and treating all of them as this
   * one would turn the fix off for an endpoint refusing something else — and
   * nobody would find out, because the only symptom is slowness.
   */
  it('recognises a refusal only when it names the field', () => {
    expect(refusedTheField(400, "Unknown parameter: 'reasoning_effort'")).toBe(true);
    expect(refusedTheField(400, 'unsupported field REASONING_EFFORT')).toBe(true);
    expect(refusedTheField(400, 'context length exceeded')).toBe(false);
    expect(refusedTheField(500, "Unknown parameter: 'reasoning_effort'")).toBe(false);
    expect(refusedTheField(404, '')).toBe(false);
  });

  it('gives a fresh start when asked, for a server that has been reconfigured', () => {
    rememberRefusal('http://strict.example/v1');
    forgetRefusals();

    expect(mayAskForNoDeliberation('http://strict.example/v1')).toBe(true);
  });
});

/**
 * When it is worth thinking about, and when it is not.
 *
 * The two mistakes are not symmetrical, and the rule is lopsided on purpose:
 * deliberating over "merhaba" costs a slow hello, while not deliberating over
 * "ekranıma bak" costs the action entirely. So this recognises the small closed
 * set of turns that are only conversation, and everything else — including
 * anything it has never seen — gets the model's full attention.
 */
describe('whether a turn needs thinking about', () => {
  const ENDPOINT = 'http://127.0.0.1:1234/v1';

  beforeEach(() => {
    forgetRefusals();
  });

  it('answers a greeting at once', () => {
    for (const said of ['Merhaba', 'merhaba!', 'Selam', 'günaydın', 'Hello', 'hi', 'Nasılsın?', 'teşekkürler']) {
      expect(speaksOnlyToChat(said), said).toBe(true);
    }
  });

  /// Every sentence the task eval scores. All eight must get the attention:
  /// these are exactly the ones that scored 5/8 when they did not.
  it('thinks about anything that might be a request', () => {
    for (const said of [
      'Favori şarkımı aç.',
      "YouTube'u aç ve bunny girl'ü bul.",
      'Ekranıma bak ve bu hata ne diyor söyle.',
      'Vurgu rengini biraz daha sıcak yap.',
      String.raw`Masaüstüm D:\Work. Masaüstüm nerede?`,
      'Bir video istediğimde YouTube’da ara ve ilk sonucu aç.',
      'Bana Tokyo’ya uçak bileti al.',
      'Hava nasıl, bir de e-postamı aç.',
    ]) {
      expect(speaksOnlyToChat(said), said).toBe(false);
    }
  });

  /// The guard that matters as much as the words.
  it('is not fooled by a request that opens with a greeting', () => {
    expect(speaksOnlyToChat('selam, ekranıma bakar mısın')).toBe(false);
    expect(speaksOnlyToChat('merhaba, favori şarkımı açar mısın')).toBe(false);
  });

  /// A short pleasantry must be a word, not a fragment inside a real one.
  it('does not mistake a longer word for a pleasantry', () => {
    expect(speaksOnlyToChat('oku bunu')).toBe(false);
    expect(speaksOnlyToChat('hikayeyi anlat')).toBe(false);
    expect(speaksOnlyToChat('tamamla şunu')).toBe(false);
  });

  it('treats a bare acknowledgement as conversation', () => {
    for (const said of ['tamam', 'evet', 'ok', 'peki', 'hayır']) {
      expect(speaksOnlyToChat(said), said).toBe(true);
    }
  });

  // Three answers, not two. Sending nothing is not "think a normal amount", it
  // is "think as much as you like" — measured at 68 seconds on a turn whose
  // answer was one line above it.
  it('answers a pleasantry with no deliberation at all', () => {
    expect(deliberationFor('merhaba', ENDPOINT)).toEqual({ reasoning_effort: 'none' });
  });

  it('gives a request room to think, bounded rather than open-ended', () => {
    expect(deliberationFor('Ekranıma bak.', ENDPOINT)).toEqual({ reasoning_effort: 'minimal' });
  });

  it('never leaves a turn unbounded, whatever was said', () => {
    for (const said of ['merhaba', 'Ekranıma bak.', 'Bana Tokyo bileti al.', 'Masaüstüm nerede?']) {
      expect(deliberationFor(said, ENDPOINT), said).not.toEqual({});
    }
  });

  /// An endpoint that refused the field gets nothing either way, rather than a
  /// request it has already objected to.
  it('sends nothing to an endpoint that refused the field', () => {
    rememberRefusal(ENDPOINT);
    expect(deliberationFor('merhaba', ENDPOINT)).toEqual({});
    // Both values of the same field, because one 400 answers for both.
    expect(deliberationFor('Ekranıma bak.', ENDPOINT)).toEqual({});
  });
});
