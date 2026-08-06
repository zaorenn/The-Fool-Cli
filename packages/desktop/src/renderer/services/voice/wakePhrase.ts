/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wake-phrase detection over a transcript.
 *
 * The phrase has to be caught inside ordinary speech — "so anyway wake up fool,
 * show me the diff" must trigger — while a recogniser that drops a letter or
 * runs words together should still be understood. Everything else must stay
 * silent: a listener that fires on "wake me up in an hour" is worse than one
 * that occasionally needs repeating.
 */

/** Letters with no Unicode decomposition that still need folding. */
const LETTER_FOLDING: Record<string, string> = {
  ı: 'i',
  İ: 'i',
  I: 'i',
  ﬁ: 'fi',
  ø: 'o',
  Ø: 'o',
  æ: 'ae',
  Æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  ð: 'd',
  þ: 'th',
  ł: 'l',
};

const fold = (value: string): string => value.replace(/[ıİIﬁøØæÆœßðþł]/g, (letter) => LETTER_FOLDING[letter] ?? letter);

/** Lowercase, unaccented, punctuation-free words. */
const words = (value: string): string[] =>
  fold(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);

/**
 * How many letters may differ before two words count as different.
 *
 * Slack is only safe when several words have to line up: "fool" one letter out
 * also matches cool, pool and tool, so a one-word phrase must be heard exactly.
 */
const tolerance = (word: string, phraseWordCount: number): number => {
  if (phraseWordCount < 2) return 0;
  if (word.length >= 6) return 2;
  if (word.length >= 4) return 1;
  return 0;
};

/** Levenshtein distance, bounded: stops as soon as it exceeds `limit`. */
const withinDistance = (left: string, right: string, limit: number): boolean => {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > limit) return false;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i = 1; i <= left.length; i += 1) {
    const current = [i, ...Array.from({ length: right.length }, () => 0)];
    let best = current[0];

    for (let j = 1; j <= right.length; j += 1) {
      const substitution = previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
      best = Math.min(best, current[j]);
    }

    if (best > limit) return false;
    previous = current;
  }

  return previous[right.length] <= limit;
};

export type WakeMatch = {
  /** Whatever was said after the phrase, so one breath can wake and instruct. */
  commandText: string;
};

export const findWakePhrase = (transcript: string, phrase: string): WakeMatch | null => {
  const wanted = words(phrase);
  const heard = words(transcript);
  if (wanted.length === 0 || heard.length === 0) return null;

  // Adjacent and in order: the words have to arrive as a phrase, not scattered
  // through a sentence.
  for (let start = 0; start + wanted.length <= heard.length; start += 1) {
    const matched = wanted.every((word, offset) =>
      withinDistance(word, heard[start + offset], tolerance(word, wanted.length))
    );
    if (matched) return { commandText: heard.slice(start + wanted.length).join(' ') };
  }

  // Recognisers sometimes emit the phrase as one token, which leaves no word
  // boundaries to slice a command out of.
  //
  // Only worth doing for a phrase of several words. A one-word phrase was
  // already compared exactly above, so all this can add is a substring hit — and
  // a substring hit is how "durum ne" cut off a reply that only "dur" was meant
  // to stop. One word is heard whole or not at all.
  if (wanted.length < 2) return null;

  const joinedWanted = wanted.join('');
  if (heard.some((word) => word.length >= joinedWanted.length && word.includes(joinedWanted))) {
    return { commandText: '' };
  }
  if (heard.join('').includes(joinedWanted)) return { commandText: '' };

  return null;
};

export const matchesWakePhrase = (transcript: string, phrase: string): boolean =>
  findWakePhrase(transcript, phrase) !== null;
