/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { guardSpokenSentence, stillOwed, type SpokenTurnEvidence } from '@renderer/services/voice/session/spokenOutput';

/** A turn that has done nothing and seen nothing, which is the interesting case. */
const nothing: SpokenTurnEvidence = { toolsRan: 0, remembered: 3, lookedAtScreen: false };

describe('guardSpokenSentence', () => {
  it('refuses a sentence claiming a completed action when no tool ran', () => {
    // The sentence is Turkish on purpose. The first detector this project
    // shipped was written against `\b`, which is defined on ASCII and matched
    // nothing in any locale this app speaks except English — so the guard
    // missed its own target sentence, silently, everywhere it mattered most.
    const verdict = guardSpokenSentence('Şimdi çalıyor.', nothing);

    expect(verdict.speak).toBe(false);
    expect(verdict.speak === false && verdict.correction.length > 0).toBe(true);
  });

  it('allows the same sentence when a tool did run', () => {
    expect(guardSpokenSentence('Şimdi çalıyor.', { ...nothing, toolsRan: 1 }).speak).toBe(true);
  });

  it('refuses a claim to remember on an empty memory', () => {
    expect(guardSpokenSentence('Hatırlıyorum, adın Serhan.', { ...nothing, remembered: 0 }).speak).toBe(false);
  });

  it('allows a claim to remember when there is something remembered', () => {
    expect(guardSpokenSentence('Hatırlıyorum, adın Serhan.', { ...nothing, remembered: 2 }).speak).toBe(true);
  });

  it('allows an ordinary sentence that claims nothing', () => {
    expect(guardSpokenSentence('Bugün hava yağmurlu.', { ...nothing, remembered: 0 }).speak).toBe(true);
  });

  it('allows an empty sentence through rather than inventing a refusal', () => {
    expect(guardSpokenSentence('   ', { ...nothing, remembered: 0 }).speak).toBe(true);
  });
});

/**
 * The third gate, and the one a tool count cannot stand in for.
 *
 * Measured before it existed: against `qwen/qwen3.5-9b`, asked to look at a
 * screen whose capture then failed and pressed a second time, the model
 * described the screen on three runs out of three. A tool had run, so every
 * check the gate had was satisfied.
 */
describe('describing a screen', () => {
  it('refuses a description when nothing has been looked at', () => {
    const verdict = guardSpokenSentence('Ekranında bir bağlantı hatası var.', nothing);
    expect(verdict.speak).toBe(false);
    expect(verdict.speak === false && verdict.correction).toContain('app_look_at_screen');
  });

  /// The hole this closes, stated as a test: a tool ran, and the tool came back
  /// with nothing. Counting calls says the claim is backed; it is not.
  it('still refuses it when a tool ran but no screen came back', () => {
    expect(guardSpokenSentence('Ekranında bir hata var.', { ...nothing, toolsRan: 2 }).speak).toBe(false);
  });

  it('allows the description once a screen has genuinely been seen', () => {
    expect(guardSpokenSentence('Ekranında bir bağlantı hatası var.', { ...nothing, lookedAtScreen: true }).speak).toBe(
      true
    );
  });

  it('never refuses the honest answer, whatever the evidence', () => {
    expect(guardSpokenSentence('Ekranını göremiyorum.', nothing).speak).toBe(true);
    expect(guardSpokenSentence('Bir bakayım.', nothing).speak).toBe(true);
  });
});

/**
 * The other half of honesty: not leaving something true unsaid.
 *
 * Reported from the app — it opened the song and never mentioned it. The turn
 * loop had no opinion about a round that ended without text, so the room simply
 * stayed quiet, and from where the user is sitting that is indistinguishable
 * from not having been heard.
 */
describe('what a silent turn still owes', () => {
  it('owes nothing when it spoke', () => {
    expect(stillOwed({ spokeAnything: true, toolsRan: 0, ranOutOfRounds: false })).toBe('nothing');
    expect(stillOwed({ spokeAnything: true, toolsRan: 3, ranOutOfRounds: true })).toBe('nothing');
  });

  it('owes a confirmation when the work happened and no sentence about it did', () => {
    expect(stillOwed({ spokeAnything: false, toolsRan: 1, ranOutOfRounds: false })).toBe('confirmation');
  });

  /// The distinction the agent path got wrong in the other direction: it said
  /// "I could not do that" whenever nothing was spoken, which is a lie of its
  /// own once the song is already playing.
  it('owes an admission when nothing was done either', () => {
    expect(stillOwed({ spokeAnything: false, toolsRan: 0, ranOutOfRounds: false })).toBe('admission');
  });

  /// A model that answers every round with another tool call has run plenty of
  /// tools and finished nothing that was asked for. "Done." there is the small
  /// false claim the gate exists to stop, arriving through the door built to
  /// prevent silence.
  it('does not confirm a turn that only ran out of rounds', () => {
    expect(stillOwed({ spokeAnything: false, toolsRan: 4, ranOutOfRounds: true })).toBe('admission');
  });
});
