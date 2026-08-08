/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { guardSpokenSentence } from '@renderer/services/voice/session/spokenOutput';

describe('guardSpokenSentence', () => {
  it('refuses a sentence claiming a completed action when no tool ran', () => {
    // The sentence is Turkish on purpose. The first detector this project
    // shipped was written against `\b`, which is defined on ASCII and matched
    // nothing in any locale this app speaks except English — so the guard
    // missed its own target sentence, silently, everywhere it mattered most.
    const verdict = guardSpokenSentence('Şimdi çalıyor.', { toolsRan: 0, remembered: 3 });

    expect(verdict.speak).toBe(false);
    expect(verdict.speak === false && verdict.correction.length > 0).toBe(true);
  });

  it('allows the same sentence when a tool did run', () => {
    expect(guardSpokenSentence('Şimdi çalıyor.', { toolsRan: 1, remembered: 3 }).speak).toBe(true);
  });

  it('refuses a claim to remember on an empty memory', () => {
    expect(guardSpokenSentence('Hatırlıyorum, adın Serhan.', { toolsRan: 0, remembered: 0 }).speak).toBe(false);
  });

  it('allows a claim to remember when there is something remembered', () => {
    expect(guardSpokenSentence('Hatırlıyorum, adın Serhan.', { toolsRan: 0, remembered: 2 }).speak).toBe(true);
  });

  it('allows an ordinary sentence that claims nothing', () => {
    expect(guardSpokenSentence('Bugün hava yağmurlu.', { toolsRan: 0, remembered: 0 }).speak).toBe(true);
  });

  it('allows an empty sentence through rather than inventing a refusal', () => {
    expect(guardSpokenSentence('   ', { toolsRan: 0, remembered: 0 }).speak).toBe(true);
  });
});
