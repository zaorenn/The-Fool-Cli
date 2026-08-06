/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Telling "carry on" apart from "stop".
 *
 * People do not listen silently. They say "mhm", "right", "evet", "anladım"
 * while the other person is still talking, and none of it is an attempt to take
 * the floor — it is how you show you are still there. An assistant that treats
 * every sound as an interruption stops mid-answer, throws the answer away, and
 * then answers "mhm" instead: the user hears nothing and has no idea why.
 *
 * So a short utterance made of nothing but acknowledgement is not a turn. It is
 * dropped, and whatever was being said carries on.
 *
 * Deliberately conservative. A false positive here swallows something the user
 * actually said, so the list holds only words that carry no request on their own,
 * and only when the whole utterance is made of them.
 */

/**
 * The most words a backchannel can be.
 *
 * "Evet, anladım" is two. "Evet, anladım ama bunu değiştirmek istiyorum" starts
 * the same way and is plainly a turn, so length is the first guard: past a few
 * words, someone is saying something.
 */
const MAX_WORDS = 3;

/**
 * Acknowledgements, in the languages this app is spoken in.
 *
 * Turkish and English carry the weight because they are what this is used in
 * daily; the rest are the obvious equivalents. Filler sounds are spelled several
 * ways because a transcriber picks one arbitrarily — Whisper writes the same
 * noise as "mhm", "hmm", "hı hı" or "ıhı" depending on the audio.
 */
const ACKNOWLEDGEMENTS: ReadonlySet<string> = new Set([
  // Sounds rather than words, and the transcriber's various spellings of them.
  'mhm',
  'mm',
  'mmm',
  'hm',
  'hmm',
  'hmhm',
  'hmm hmm',
  'uhhuh',
  'uh huh',
  'ahh',
  'ah',
  'aha',
  'hı',
  'hıhı',
  'ıhı',
  'ıh',
  'he',
  'hee',
  // Turkish
  'evet',
  'aynen',
  'tamam',
  'tamamdır',
  'anladım',
  'anlıyorum',
  'peki',
  'tabii',
  'tabi',
  'doğru',
  'olur',
  'oldu',
  'devam',
  'hah',
  'öyle',
  'harika',
  'güzel',
  'süper',
  // English
  'yeah',
  'yep',
  'yes',
  'yup',
  'ok',
  'okay',
  'right',
  'sure',
  'exactly',
  'true',
  'nice',
  'cool',
  'great',
  'i see',
  'got it',
  'go on',
  'carry on',
  // The rest of the interface languages, one or two each.
  'ja',
  'genau',
  'oui',
  'voilà',
  'sí',
  'claro',
  'sim',
  'certo',
  'да',
  'ага',
  'понятно',
  'так',
  'зрозуміло',
  'はい',
  'うん',
  'ええ',
  '네',
  '응',
  '嗯',
  '对',
  '好',
  '好的',
  'بله',
  'باشه',
]);

/** Punctuation a transcriber adds that carries no meaning of its own. */
const TRIMMED = /^[\s.,!?;:…"'`´()[\]{}\-–—]+|[\s.,!?;:…"'`´()[\]{}\-–—]+$/gu;

/** Combining accents, once a decomposition has separated them from their letter. */
const COMBINING = /[̀-ͯ]/gu;

/** The dotless i, which has no decomposition to strip an accent from. */
const DOTLESS_I = /ı/gu;

/**
 * Folded to the shape a transcriber actually writes.
 *
 * Whisper drops Turkish diacritics as often as it keeps them — the same "evet,
 * anladım" comes back as "evet anladim" on the next utterance, and the list is
 * spelled only one of those ways. Folding both sides means the spelling stops
 * mattering: "hıhı" and "hihi" are the same sound either way.
 *
 * Only Latin accents are touched. Decomposition leaves Cyrillic, Japanese,
 * Korean, Chinese and Persian alone, which is what the rest of the list needs.
 */
const normalise = (text: string): string =>
  text
    .toLocaleLowerCase('tr')
    .replaceAll(DOTLESS_I, 'i')
    .normalize('NFKD')
    .replaceAll(COMBINING, '')
    .replaceAll(TRIMMED, '')
    .replaceAll(/\s+/gu, ' ')
    .trim();

/** The list in the same folded shape, so a lookup compares like with like. */
const FOLDED: ReadonlySet<string> = new Set([...ACKNOWLEDGEMENTS].map((word) => normalise(word)));

/**
 * Whether this utterance is only an acknowledgement.
 *
 * True for "mhm", "evet", "tamam anladım". False for anything with a request in
 * it, anything longer than a few words, and empty text — an empty transcript is
 * a failure to hear rather than a "carry on", and the two want different
 * handling.
 */
export const isBackchannel = (text: string): boolean => {
  const cleaned = normalise(text);
  if (cleaned.length === 0) return false;

  // The whole thing as one phrase first, so "uh huh" and "i see" are found
  // before they are split into words that are not acknowledgements alone.
  if (FOLDED.has(cleaned)) return true;

  const words = cleaned.split(' ').map((word) => word.replaceAll(TRIMMED, ''));
  if (words.length > MAX_WORDS) return false;
  return words.every((word) => word.length > 0 && FOLDED.has(word));
};
