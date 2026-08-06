/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether what was just said is about something the user can see.
 *
 * "Look at my screen" was never the problem — that one is unambiguous and the
 * model calls the tool. The problem is everything else people actually say:
 * "what does this error mean", "is this right?", "bu ne diyor", "şuna bak" —
 * all of which refer to a screen without naming one. Asked those, the model
 * answers from nothing, and it answers confidently, which is the failure mode
 * that matters here: a made-up screen sounds exactly like a real one.
 *
 * Telling the model to reason about it helps and is not enough on its own; it
 * has no sense of *not* being able to see, so a rule about when to look is a
 * rule it has to remember to apply. This is the deterministic half: the
 * sentence is examined before the model is asked anything, and when it plainly
 * points at a screen the turn carries an instruction to go and look.
 *
 * Deliberately pattern-based rather than a classifier. "This" and "bu" alone
 * mean nothing — half of ordinary speech contains one — so what is matched is a
 * pointing word standing next to something a screen has: an error, a message, a
 * page, a window, what something says. That is narrow enough to almost never
 * fire on a conversation about the weather, which matters because a false
 * positive costs a screenshot and several seconds of silence.
 */

/**
 * Phrases that name the screen outright, in the languages this is spoken in.
 *
 * These need no pointing word beside them: someone who says "on my screen" is
 * talking about their screen.
 */
const SCREEN_WORDS = [
  // English
  'my screen',
  'the screen',
  'on screen',
  'this window',
  'that window',
  'this page',
  'that page',
  'this tab',
  'am i looking at',
  "what's open",
  'what is open',
  'in front of me',
  // Turkish
  'ekranım',
  'ekranima',
  'ekranımda',
  'ekranimda',
  'ekranda',
  'ekrana',
  'bu pencere',
  'şu pencere',
  'su pencere',
  'bu sayfa',
  'şu sayfa',
  'su sayfa',
  'bu sekme',
  'açık olan',
  'acik olan',
  'önümde',
  'onumde',
] as const;

/** Words that point at something without naming it. */
const POINTERS = [
  'this',
  'that',
  'these',
  'those',
  'it',
  'here',
  'there',
  'bu',
  'şu',
  'su',
  'bunu',
  'şunu',
  'sunu',
  'bunlar',
  'şunlar',
  'burada',
  'şurada',
  'surada',
  'buradaki',
  'şuradaki',
] as const;

/** Things only a screen has, which a pointing word beside one is pointing at. */
const SCREEN_THINGS = [
  // English
  'error',
  'message',
  'warning',
  'dialog',
  'button',
  'menu',
  'popup',
  'notification',
  'log',
  'output',
  'code',
  'says',
  'say',
  'said',
  'written',
  'reads',
  'shows',
  'showing',
  'looks like',
  'look right',
  'right?',
  'correct',
  'mean',
  'means',
  // Turkish
  'hata',
  'hatayı',
  'hatayi',
  'mesaj',
  'uyarı',
  'uyari',
  'buton',
  'düğme',
  'dugme',
  'menü',
  'menu',
  'bildirim',
  'çıktı',
  'cikti',
  'kod',
  'yazıyor',
  'yaziyor',
  'yazan',
  'diyor',
  'gösteriyor',
  'gosteriyor',
  'görünüyor',
  'gorunuyor',
  'doğru mu',
  'dogru mu',
  'ne demek',
  'anlamı',
  'anlami',
] as const;

/** Asking what is visible, with no pointing word needed. */
const SEEING = [
  'what do you see',
  'can you see',
  'do you see',
  'ne görüyorsun',
  'ne goruyorsun',
  'görüyor musun',
  'goruyor musun',
  'bakar mısın',
  'bakar misin',
  'bir bak',
  'bakabilir misin',
] as const;

/**
 * Turkish written without its diacritics, which is how it is often transcribed.
 *
 * The lists above carry both spellings for the words where it matters, and this
 * folds the input so a transcript that kept the diacritics still matches the
 * plain entries. Cheaper and more predictable than normalising both sides.
 */
const fold = (text: string): string =>
  text
    .toLowerCase()
    .replaceAll('ı', 'i')
    .replaceAll('ş', 's')
    .replaceAll('ğ', 'g')
    .replaceAll('ü', 'u')
    .replaceAll('ö', 'o')
    .replaceAll('ç', 'c')
    .replaceAll('İ', 'i');

const containsAny = (haystack: string, needles: readonly string[]): boolean =>
  needles.some((needle) => haystack.includes(fold(needle)));

/**
 * How far apart a pointing word and a screen thing may be and still be related.
 *
 * Measured in characters rather than words because the transcript has no
 * reliable word boundaries in every language this handles. Roughly a clause.
 */
const POINTER_REACH = 40;

/** True when a pointing word stands close to something only a screen has. */
const pointsAtSomethingVisible = (text: string): boolean => {
  for (const pointer of POINTERS) {
    const folded = fold(pointer);
    let at = text.indexOf(folded);
    while (at !== -1) {
      // A word, not a fragment of one: "it" must not match inside "situation".
      const before = at === 0 ? ' ' : text[at - 1];
      const after = text[at + folded.length] ?? ' ';
      const isWord = !/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after);
      if (isWord) {
        const window = text.slice(Math.max(0, at - POINTER_REACH), at + folded.length + POINTER_REACH);
        if (containsAny(window, SCREEN_THINGS)) return true;
      }
      at = text.indexOf(folded, at + 1);
    }
  }
  return false;
};

/**
 * Whether the assistant should look at the screen before answering this.
 *
 * Answered from the words alone, with no model involved, so it costs nothing
 * and cannot itself hallucinate.
 */
export const refersToScreen = (transcript: string): boolean => {
  const text = fold(transcript);
  if (text.trim().length === 0) return false;
  if (containsAny(text, SCREEN_WORDS)) return true;
  if (containsAny(text, SEEING)) return true;
  return pointsAtSomethingVisible(text);
};
