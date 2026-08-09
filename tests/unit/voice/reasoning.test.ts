/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetRefusals,
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
