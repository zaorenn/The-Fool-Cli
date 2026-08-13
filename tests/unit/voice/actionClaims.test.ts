/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  asksToBeReminded,
  backsCompletedAction,
  claimsAboutScreen,
  claimsCompletedAction,
  claimsPlayback,
  claimsRecall,
  emptyRecallCorrection,
  isEmptyRecall,
  isUnbackedClaim,
  isUnseenScreenClaim,
  isUnverifiedPlaybackClaim,
  startedPlayback,
  unbackedClaimCorrection,
  unseenScreenCorrection,
  unverifiedPlaybackCorrection,
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

describe('claims the detector used to miss', () => {
  it('catches a purchase, which is the costliest claim it can make', () => {
    // Reported from a real conversation: asked to buy a plane ticket, the model
    // said it had, no tool ran, and the sentence was spoken to the user.
    expect(claimsCompletedAction('Tamam, bileti aldım.')).toBe(true);
    expect(claimsCompletedAction('Rezervasyonu yaptım.')).toBe(true);
    expect(claimsCompletedAction('Siparişi verdim.')).toBe(true);
    expect(claimsCompletedAction("I've booked it for you.")).toBe(true);
  });

  it('catches the other completions that were missing', () => {
    expect(claimsCompletedAction('Buldum, işte burada.')).toBe(true);
    expect(claimsCompletedAction('Listeye ekledim.')).toBe(true);
    expect(claimsCompletedAction('Şarkıyı çaldım.')).toBe(true);
  });

  it('still lets "understood" through, which is not a claim about the world', () => {
    // `aldim` on its own is how somebody says "got it". Refusing that would
    // call the assistant a liar for agreeing, which is the false positive this
    // file says is worse than a miss.
    expect(claimsCompletedAction('Anladım, aldım.')).toBe(false);
  });

  it('still lets a question through', () => {
    expect(claimsCompletedAction('Bileti alayım mı?')).toBe(false);
  });
});

/**
 * The grammatical rule, rather than another verb in the list.
 *
 * The list grew a word at a time and every addition arrived the same way:
 * somebody was lied to, the word was noted, the word was added. There are as
 * many verbs as there are things a person can ask for, so the list was always
 * one conversation behind. Turkish marks a finished first-person action in the
 * word itself, so the suffix is the rule and the exemptions are the closed set.
 */
describe('a finished action, by its grammar', () => {
  it('catches verbs nobody thought to write down', () => {
    for (const said of [
      'Faturayı ödedim.',
      'Toplantıyı iptal ettim.',
      'Dosyayı yükledim.',
      'Işıkları söndürdüm.',
      'Numarayı çevirdim.',
      'Bilgisayarı yeniden başlattım.',
      'Randevuyu erteledim.',
    ]) {
      expect(claimsCompletedAction(said), said).toBe(true);
    }
  });

  it('leaves a denial alone', () => {
    // "yapmadım" is the opposite of a claim, and a rule that reads the suffix
    // without the negation in front of it calls an honest answer a lie.
    for (const said of ['Hayır, açmadım.', 'Onu göndermedim.', 'Hiçbir şey yapmadım.', 'Bulamadım.']) {
      expect(claimsCompletedAction(said), said).toBe(false);
    }
  });

  it('leaves something that was under way alone', () => {
    for (const said of ['Bakıyordum ama bulamadım henüz.', 'Onu deniyordum.']) {
      expect(claimsCompletedAction(said), said).toBe(false);
    }
  });

  it('leaves the speaker talking about themselves alone', () => {
    // Understanding, hearing and seeing are not changes to the world, and this
    // is the list that is allowed to exist because it does not grow.
    for (const said of ['Anladım.', 'Tamam, aldım.', 'Seni duydum.', 'Ne demek istediğini anladım.']) {
      expect(claimsCompletedAction(said), said).toBe(false);
    }
  });

  it('applies the same rule to English regular verbs', () => {
    expect(claimsCompletedAction('I cancelled the meeting.')).toBe(true);
    expect(claimsCompletedAction('I uploaded the file.')).toBe(true);
    expect(claimsCompletedAction('I wanted to check first.')).toBe(false);
    expect(claimsCompletedAction('I tried but it did not work.')).toBe(false);
  });
});

/**
 * Not every tool that answers has done anything.
 *
 * A task handed to the agent comes back the moment it is accepted — the flight
 * is not booked and will not be for minutes. Counted as evidence it would open
 * the gate's own hole one level along: the claim would have a tool behind it,
 * and the tool would only have agreed to start.
 */
describe('what a tool result is evidence of', () => {
  it('takes an ordinary result as evidence the work is done', () => {
    expect(backsCompletedAction({ ok: true, opened: 1 })).toBe(true);
  });

  it('does not take an accepted task as evidence of anything finished', () => {
    expect(backsCompletedAction({ ok: true, accepted: true, result: 'started' })).toBe(false);
  });

  it('takes a result it cannot read as evidence, rather than refusing honest reports', () => {
    expect(backsCompletedAction('done')).toBe(true);
    expect(backsCompletedAction(null)).toBe(true);
    expect(backsCompletedAction(undefined)).toBe(true);
  });
});

/**
 * The lie a persona rule could not stop.
 *
 * "Never describe a screen you have not looked at" has been in the persona from
 * the beginning and cut the frequency to roughly one turn in six. The remaining
 * one is the one that matters, because an invented screen is *confirmed* by the
 * user looking at their own: they find something, and something is usually close
 * enough to whatever was guessed.
 */
describe('claimsAboutScreen', () => {
  it('catches a description of a screen', () => {
    for (const said of [
      'Ekranında bir bağlantı hatası var.',
      'Ekranda VS Code açık.',
      'Şu an ekranında bir uyarı mesajı görünüyor.',
      'Hata mesajı portun kullanımda olduğunu söylüyor.',
      'Your screen shows a connection error.',
      'I can see a dialog asking for permission.',
      'There is an error in the terminal.',
      'The page says the file was not found.',
    ]) {
      expect(claimsAboutScreen(said), said).toBe(true);
    }
  });

  /// Hedging is the same mistake said less clearly, and it is the form the model
  /// reaches for once it has been told off once.
  it('catches the hedged version, which is what it retreats to', () => {
    expect(claimsAboutScreen('Ekranda bir hata var gibi görünüyor.')).toBe(true);
    expect(claimsAboutScreen('It looks like there is an error dialog open.')).toBe(true);
  });

  /// The sentence this whole gate is trying to produce more of. Refusing it
  /// would leave the assistant with no honest answer at all.
  it('leaves saying plainly that it cannot see', () => {
    for (const said of [
      'Ekranını göremiyorum.',
      'Ekranına bakmadım, o yüzden ne yazdığını bilmiyorum.',
      "I can't see your screen.",
      'I have not looked at the screen yet.',
    ]) {
      expect(claimsAboutScreen(said), said).toBe(false);
    }
  });

  /// Announce, then call. The same exemption the action gate gives, for the same
  /// reason: it is the behaviour the prompt is asking for.
  it('leaves saying it is about to look', () => {
    for (const said of [
      'Ekranına bakıyorum.',
      'Bir bakayım, ekran görüntüsü alıyorum.',
      'Let me look at your screen.',
      "I'm checking the screen now.",
    ]) {
      expect(claimsAboutScreen(said), said).toBe(false);
    }
  });

  it('leaves a question alone', () => {
    expect(claimsAboutScreen('Ekranında bir hata mı var?')).toBe(false);
    expect(claimsAboutScreen('Is there an error on your screen?')).toBe(false);
  });

  it('does not fire on a sentence that is about nothing visible', () => {
    for (const said of [
      'Bugün hava güzel görünüyor.',
      'Tamam, şarkıyı açıyorum.',
      'I have written that down.',
      'Merhaba, nasılsın?',
    ]) {
      expect(claimsAboutScreen(said), said).toBe(false);
    }
  });
});

describe('isUnseenScreenClaim', () => {
  it('refuses a description when nothing was looked at', () => {
    expect(isUnseenScreenClaim('Ekranında bir hata var.', false)).toBe(true);
  });

  /// Conversation-wide rather than per turn, and deliberately so: "what did that
  /// error say again?" one turn after a real look is a correct answer drawn from
  /// a screenshot that is genuinely in the history.
  it('allows it once a look has actually happened', () => {
    expect(isUnseenScreenClaim('Ekranında bir hata var.', true)).toBe(false);
  });

  it('names the tool in the correction, not just the mistake', () => {
    const correction = unseenScreenCorrection('Ekranda bir hata var.');
    expect(correction).toContain('Ekranda bir hata var.');
    expect(correction).toContain('app_look_at_screen');
  });
});

/**
 * The fourth lie, and the one the first three were shaped to miss.
 *
 * Observed in the app. Asked for a favourite song, the assistant ran four tools
 * — a search, a click, and two screenshots — and finished with three sentences
 * that cannot all be true: it should now be playing, the video is loaded and
 * ready to play, and shall I press play for you. `claimsCompletedAction` never
 * fired, because "should now be playing" is a hedge rather than a past tense;
 * `isUnbackedClaim` would have allowed it anyway, because four tools had run.
 */
describe('claimsPlayback', () => {
  it('catches the sentence the user was actually told', () => {
    for (const reply of [
      "Your favourite song 'Bunny Girl' should now be playing in the browser!",
      'The video is loaded and ready to play.',
      'It is now playing.',
      'Now playing: Bunny Girl.',
      'It must be playing in your browser.',
      'It started playing.',
    ]) {
      expect(claimsPlayback(reply), reply).toBe(true);
    }
  });

  it('catches the same claim in Turkish', () => {
    for (const reply of ['Şimdi çalıyor.', 'Çalıyor olmalı.', 'Şarkı çalmaya başladı.', 'Video oynatılıyor.']) {
      expect(claimsPlayback(reply), reply).toBe(true);
    }
  });

  /**
   * The sentence this gate wants more of. Built from the same words as the lie,
   * so it has to win outright rather than by not matching.
   */
  it('leaves the honest admission alone', () => {
    for (const reply of [
      "I can't play it.",
      'It is not playing.',
      "I don't know whether it started.",
      'Çalmıyor.',
      'Çaldığından emin değilim.',
    ]) {
      expect(claimsPlayback(reply), reply).toBe(false);
    }
  });

  /**
   * Announcing work about to happen is what the prompt asks for. Refusing it
   * would leave nothing sayable between the request and the tool.
   */
  it('leaves an announcement of work about to happen alone', () => {
    for (const reply of ['I am putting it on now.', 'Let me play that.', 'Hemen açıyorum.', 'Şarkıyı arıyorum.']) {
      expect(claimsPlayback(reply), reply).toBe(false);
    }
  });

  it('says nothing about a sentence that claims nothing', () => {
    expect(claimsPlayback('Bugün hava yağmurlu.')).toBe(false);
    expect(claimsPlayback('')).toBe(false);
  });
});

/**
 * The evidence is the result, never the invocation.
 *
 * `app_play` is deliberately just as successful having opened a page instead of
 * having started a song — that is its fallback when nothing is connected. So
 * the tool having run says nothing at all, and only `playing: true` beside a
 * device is evidence that sound is coming out.
 */
describe('startedPlayback', () => {
  it('accepts a player that named the track and the device', () => {
    expect(startedPlayback('app_play', { ok: true, playing: true, track: 'Bunny Girl', device: 'Kitchen' })).toBe(true);
  });

  /// The exact shape of the observed failure: the call succeeded, and all it
  /// did was hand an address to a browser.
  it('refuses a page that merely opened', () => {
    expect(startedPlayback('app_play', { ok: true, playing: false, opened: true, url: 'https://example.com' })).toBe(
      false
    );
  });

  it('refuses a player that failed', () => {
    expect(startedPlayback('app_play', { ok: false, error: 'no-device' })).toBe(false);
  });

  /**
   * The tools that end with an address in a browser are deliberately not
   * players, however successfully they ran. That substitution is the whole
   * thing this gate exists to refuse.
   */
  it('refuses every tool that is not a player, whatever it answered', () => {
    for (const name of ['app_open_url', 'app_search', 'app_skill_do', 'app_look_at_screen', 'app_ask_jester']) {
      expect(startedPlayback(name, { ok: true, playing: true }), name).toBe(false);
    }
  });

  it('refuses a result that is not an object at all', () => {
    expect(startedPlayback('app_play', null)).toBe(false);
    expect(startedPlayback('app_play', 'playing')).toBe(false);
    expect(startedPlayback('app_play', undefined)).toBe(false);
  });
});

describe('isUnverifiedPlaybackClaim', () => {
  it('refuses the claim when nothing reported playback', () => {
    expect(isUnverifiedPlaybackClaim('It should now be playing.', false)).toBe(true);
  });

  it('allows it once a player has said so', () => {
    expect(isUnverifiedPlaybackClaim('It is now playing.', true)).toBe(false);
  });

  /**
   * Named rather than only corrected. Told merely that it did not verify
   * something, a model says the same thing in a softer hedge — which is how
   * "it is playing" became "it should be playing" in the first place.
   */
  it('names the honest sentence in the correction', () => {
    const correction = unverifiedPlaybackCorrection('It should now be playing.');

    expect(correction).toContain('It should now be playing.');
    expect(correction).toContain('opened');
    expect(correction).toContain('app_play');
  });
});
