/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  asksToBeReminded,
  claimsCompletedAction,
  claimsRecall,
  emptyRecallCorrection,
  isEmptyRecall,
  isUnbackedClaim,
  unbackedClaimCorrection,
} from '@/common/voice/actionClaims';

describe('claimsCompletedAction', () => {
  it('catches the sentence this was written for', () => {
    // Watched in the app: said with an empty activity list behind it, no tool
    // called, nothing playing, and a user who believed their song was on.
    expect(claimsCompletedAction('Şimdi çalıyor.')).toBe(true);
  });

  it('catches a claim that something was done, in Turkish', () => {
    for (const reply of [
      'Tamamdır, açtım.',
      'Mesajı gönderdim.',
      'Şarkıyı kaydettim.',
      'Uygulamayı indirdim ve kurdum.',
      'İstediğin dosya oluşturuldu.',
      'Çalmaya başladı.',
    ]) {
      expect(claimsCompletedAction(reply), reply).toBe(true);
    }
  });

  it('catches a claim that something was done, in English', () => {
    for (const reply of [
      "It's playing now.",
      "I've opened it for you.",
      'I sent it.',
      "That's done.",
      'The file has been saved.',
    ]) {
      expect(claimsCompletedAction(reply), reply).toBe(true);
    }
  });

  it('leaves an announcement of work about to happen alone', () => {
    // This is the behaviour the rules ask for — announce, then call. Treating
    // it as a lie would punish exactly what the prompt is trying to produce.
    for (const reply of [
      'Hemen açıyorum.',
      'Bir saniye, bakıyorum.',
      'Şarkıyı arıyorum.',
      "I'm opening it now.",
      'One moment, let me look.',
    ]) {
      expect(claimsCompletedAction(reply), reply).toBe(false);
    }
  });

  it('never treats a question as a claim', () => {
    for (const reply of ['Favori şarkını açayım mı?', 'Shall I open it?', 'Bunu mu kaydedeyim?']) {
      expect(claimsCompletedAction(reply), reply).toBe(false);
    }
  });

  it('does not mistake a promise or a refusal for a claim', () => {
    for (const reply of [
      'Açacağım ama önce adresi bulmam lazım.',
      'Bunu yapamam çünkü adresini bilmiyorum.',
      'Ne çalmamı istersin?',
      'Bugün hava güzel.',
    ]) {
      expect(claimsCompletedAction(reply), reply).toBe(false);
    }
  });

  it('says nothing about an empty reply', () => {
    expect(claimsCompletedAction('')).toBe(false);
    expect(claimsCompletedAction('   ')).toBe(false);
  });
});

describe('isUnbackedClaim', () => {
  it('refuses a claim with no tool behind it', () => {
    expect(isUnbackedClaim('Şimdi çalıyor.', 0)).toBe(true);
  });

  it('accepts the same words once a tool has actually run', () => {
    // Backed by a tool that came back, this is the assistant reporting its
    // work, which is exactly what it is supposed to do.
    expect(isUnbackedClaim('Şimdi çalıyor.', 1)).toBe(false);
  });

  it('leaves an ordinary answer alone whether or not a tool ran', () => {
    expect(isUnbackedClaim('Bugün 8 Ağustos.', 0)).toBe(false);
    expect(isUnbackedClaim('Bugün 8 Ağustos.', 2)).toBe(false);
  });
});

describe('claimsRecall', () => {
  it('catches the sentence this was written for', () => {
    // Watched in the app, with an empty memory behind it: agreeing that it
    // remembers, then asking the user what it was.
    expect(claimsRecall('Hımm... Evet, bir şeyler hatırladım gibi. Daha önce bana ne söylemiştin?')).toBe(true);
  });

  it('catches a claim to remember, in both languages', () => {
    for (const reply of [
      'Evet, hatırlıyorum.',
      'Bunu daha önce söylemiştin.',
      'I remember that.',
      'You told me this before.',
    ]) {
      expect(claimsRecall(reply), reply).toBe(true);
    }
  });

  it('leaves an honest blank alone', () => {
    for (const reply of [
      'Bu konuda kayıtlı bir şeyim yok.',
      'Hatırlamıyorum, ister misin kaydedeyim?',
      "I don't have anything recorded about that.",
    ]) {
      expect(claimsRecall(reply), reply).toBe(false);
    }
  });
});

describe('isEmptyRecall', () => {
  it('refuses a recollection with nothing behind it', () => {
    expect(isEmptyRecall('Evet, hatırlıyorum.', 0)).toBe(true);
  });

  it('accepts it once there is something to have remembered', () => {
    expect(isEmptyRecall('Evet, hatırlıyorum.', 3)).toBe(false);
  });

  it('is not escaped by ending in a question', () => {
    // The exact sentence: agreeing it remembers, then asking what it was. A
    // trailing question mark is how this lie is usually punctuated.
    expect(isEmptyRecall('Evet, bir şeyler hatırladım gibi. Ne söylemiştin?', 0)).toBe(true);
  });
});

describe('emptyRecallCorrection', () => {
  it('forbids the "tip of my tongue" move it was caught doing', () => {
    const correction = emptyRecallCorrection('Evet, hatırlıyorum.');

    expect(correction).toContain('"Evet, hatırlıyorum."');
    expect(correction).toMatch(/remind you/i);
    expect(correction).toMatch(/nothing recorded/i);
  });
});

describe('unbackedClaimCorrection', () => {
  it('quotes what was said, so the model has nothing to argue with', () => {
    const correction = unbackedClaimCorrection('  Şimdi çalıyor.  ');

    expect(correction).toContain('"Şimdi çalıyor."');
    expect(correction).toContain('called no tool');
    expect(correction).toMatch(/call the tool/i);
  });

  it('sends it to the agent rather than letting it plead inability', () => {
    // Almost nothing here is genuinely impossible — the agent drives the real
    // machine. A model allowed to say "I can't" will take that exit instead of
    // doing the work, and the user is no better off than being lied to.
    const correction = unbackedClaimCorrection('Şimdi çalıyor.');

    expect(correction).toContain('app_ask_jester');
    expect(correction).toMatch(/only say you cannot .* after a tool/i);
  });
});

describe('claiming to remember and asking to be reminded', () => {
  // Watched in 2.3.7, with the guard already shipped: the memory held other
  // things, so the length check passed and the sentence went straight through.
  const seen =
    'Hımm... favori şarkın mı? Evet, hatırlıyorum, bu konuda konuşmuştuk ve bana söylemiştin de. Ama tam olarak ne olduğunu tekrar söyler misin?';

  it('recognises the request to be reminded', () => {
    expect(asksToBeReminded(seen)).toBe(true);
    expect(asksToBeReminded('Remind me what it was.')).toBe(true);
    expect(asksToBeReminded('Favori şarkını açıyorum.')).toBe(false);
  });

  it('is hollow however much the memory holds', () => {
    // Someone who remembers does not need reminding. Counting the memory
    // answers "is anything remembered"; the question is "is *this* remembered".
    expect(isEmptyRecall(seen, 4000)).toBe(true);
  });

  it('still lets a real recollection through', () => {
    expect(isEmptyRecall('Evet, hatırlıyorum — Bunny Girl.', 4000)).toBe(false);
  });
});
