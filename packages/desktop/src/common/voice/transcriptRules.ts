/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turning what a transcriber heard into what the person meant.
 *
 * A speech model is faithful, and faithful is not what anyone wants read back to
 * them or sent to an agent. It writes down the "ıııı" while you thought, it
 * writes "salı, pardon, çarşamba" exactly as said, and it repeats the word you
 * stumbled over twice. All three are correct transcriptions and all three are
 * noise in the instruction underneath.
 *
 * These are text rules rather than model settings on purpose: they have to work
 * the same whether the audio went through the local Whisper, a remote endpoint,
 * or a speech-to-speech provider that never produced an intermediate transcript
 * anyone configured. Every rule is separately switchable, because each one can
 * be wrong — someone dictating a transcript verbatim wants none of them.
 */

export type TranscriptRules = {
  /** Drop hesitation sounds: "ııı", "eee", "um", "uh". */
  removeFillers: boolean;
  /** Honour a spoken correction: "salı, pardon, çarşamba" becomes "çarşamba". */
  selfCorrection: boolean;
  /** Collapse a word said twice in a row while stumbling over it. */
  collapseRepeats: boolean;
  /** Extra hesitation words, for a speaker or a language with its own. */
  customFillers: readonly string[];
};

export const DEFAULT_TRANSCRIPT_RULES: TranscriptRules = {
  removeFillers: true,
  selfCorrection: true,
  collapseRepeats: true,
  customFillers: [],
};

/**
 * Hesitation sounds, across the languages this app is translated into.
 *
 * One list rather than one per language: a Turkish speaker says "hmm" and an
 * English speaker says "eee" often enough, and a filler in the wrong language is
 * still a filler. Only sounds are listed — never a real word. "şey" and "like"
 * are the obvious omissions: both are used as filler constantly and both carry
 * meaning, and removing a meaningful word is a worse failure than leaving a
 * hesitation in.
 */
const FILLERS: readonly string[] = [
  'ııı',
  'ıı',
  'eee',
  'ee',
  'ııhh',
  'ıhh',
  'hmm',
  'hmmm',
  'mmm',
  'um',
  'umm',
  'uh',
  'uhh',
  'erm',
  'ähm',
  'äh',
  'euh',
  'eh',
  'ehm',
];

/**
 * Words that announce a correction of what was just said.
 *
 * Split by how much they take back. A "cue" replaces the single word or short
 * phrase before it — "salı, pardon, çarşamba". Nothing here restarts the whole
 * sentence, because a rule that could delete an entire instruction on hearing
 * one word is not one to run without being asked.
 */
const CORRECTION_CUES: readonly string[] = [
  'pardon',
  'affedersin',
  'affedersiniz',
  'yok yok',
  'yanlış',
  'düzeltiyorum',
  'sorry',
  'i mean',
  'i meant',
  'rather',
  'no wait',
  'scratch that',
  'perdón',
  'quiero decir',
  'entschuldigung',
  'ich meine',
  'pardon je veux dire',
  'je veux dire',
];

/** Punctuation that clings to a word and must not defeat a comparison. */
const stripEdgePunctuation = (word: string): string =>
  word.replace(/^[\s.,!?;:¡¿"'«»()[\]…]+/u, '').replace(/[\s.,!?;:"'«»()[\]…]+$/u, '');

/**
 * Case-folded for comparison, the way the rest of the world folds.
 *
 * `İ` is mapped explicitly because `toLowerCase` leaves it alone in a
 * language-neutral locale, and a capitalised Turkish word would otherwise never
 * match its own lower-case spelling.
 */
const fold = (word: string): string => stripEdgePunctuation(word).replace(/İ/g, 'i').toLowerCase();

/**
 * The same word folded the Turkish way, where capital `I` is dotless `ı`.
 *
 * Kept as a second candidate rather than replacing the first, because the two
 * languages disagree and both are spoken to this app: folded only the Turkish
 * way, English "I" becomes "ı" and the correction cue "I mean" stops matching;
 * folded only the neutral way, a shouted "III" never matches the hesitation
 * "ııı". Comparing against both costs one string and settles it.
 */
const foldTurkish = (word: string): string => stripEdgePunctuation(word).replace(/I/g, 'ı').toLowerCase();

/** True when either reading of the word is the one being looked for. */
const isWord = (token: string, target: string): boolean => fold(token) === target || foldTurkish(token) === target;

/** Splits on whitespace, keeping the original spelling of every token. */
const tokenize = (text: string): string[] => text.split(/\s+/).filter((token) => token.length > 0);

const buildFillerSet = (rules: TranscriptRules): Set<string> => {
  const set = new Set(FILLERS.map(fold));
  for (const custom of rules.customFillers) {
    const folded = fold(custom);
    if (folded.length > 0) set.add(folded);
  }
  return set;
};

/**
 * Removes hesitation sounds, and the punctuation left stranded by removing them.
 *
 * A filler is only dropped when the whole token is one: "eee" goes, "eeee-vet"
 * stays, and so does any word that merely starts with the same letters.
 */
export const removeFillers = (text: string, rules: TranscriptRules): string => {
  const fillers = buildFillerSet(rules);
  const kept = tokenize(text).filter((token) => {
    const folded = fold(token);
    // A token that was *only* punctuation folds to nothing; keep it, since it
    // is the sentence's own punctuation rather than a filler.
    if (folded.length === 0) return true;
    return !fillers.has(folded) && !fillers.has(foldTurkish(token));
  });
  return kept.join(' ');
};

/**
 * Collapses a word repeated immediately, as happens mid-stumble.
 *
 * Only an exact adjacent repeat, and never a word that legitimately doubles:
 * "çok çok iyi" and "very very good" are emphasis, not a stumble, and a rule
 * that flattened them would be changing what was said.
 */
const EMPHASIS_WORDS = new Set(['çok', 'very', 'really', 'so', 'no', 'hayır', 'evet', 'yes', 'ha', 'sehr', 'très']);

export const collapseRepeats = (text: string): string => {
  const tokens = tokenize(text);
  const kept: string[] = [];
  for (const token of tokens) {
    const previous = kept[kept.length - 1];
    const folded = fold(token);
    if (previous !== undefined && fold(previous) === folded && folded.length > 0 && !EMPHASIS_WORDS.has(folded)) {
      // Keep the later spelling: the second attempt is usually the clearer one,
      // and it carries whatever punctuation ended the phrase.
      kept[kept.length - 1] = token;
      continue;
    }
    kept.push(token);
  }
  return kept.join(' ');
};

/**
 * How many words the cue took back, decided from the repair itself.
 *
 * One word is the default and the common case: a day, a name, a number. Two only
 * when the repair visibly mirrors what it replaces — "saat **on** altı, pardon,
 * **on** yedi", where the word after the cue repeats the second-to-last word
 * before it. That mirroring is what a person does when correcting the tail of a
 * phrase, and it is the only signal here strong enough to justify deleting an
 * extra word of a real instruction.
 */
const retractedWordCount = (kept: readonly string[], replacement: readonly string[]): number => {
  if (kept.length < 2 || replacement.length < 2) return 1;
  return isWord(replacement[0], fold(kept[kept.length - 2])) ? 2 : 1;
};

/**
 * Applies a spoken correction to the words it was aimed at.
 *
 * "Toplantı salı, pardon, çarşamba" becomes "Toplantı çarşamba". The cue itself
 * goes, along with the word or two before it, and what follows stands.
 *
 * A cue with nothing after it is left alone entirely: "sorry" at the end of a
 * sentence is an apology, and there is no replacement to put anywhere.
 */
export const applySelfCorrection = (text: string): string => {
  const cues = CORRECTION_CUES.map((cue) => cue.split(' ').map(fold));
  const tokens = tokenize(text);
  const kept: string[] = [];

  let index = 0;
  while (index < tokens.length) {
    const matched = cues.find((cue) => cue.every((word, offset) => isWord(tokens[index + offset] ?? '', word)));

    if (!matched) {
      kept.push(tokens[index]);
      index += 1;
      continue;
    }

    const after = index + matched.length;
    // Nothing said after the cue, or nothing before it, means nothing was
    // corrected — an apology rather than a repair.
    if (after >= tokens.length || kept.length === 0) {
      kept.push(tokens[index]);
      index += 1;
      continue;
    }

    const retracted = Math.min(retractedWordCount(kept, tokens.slice(after)), kept.length);
    kept.splice(kept.length - retracted, retracted);
    index = after;
  }

  return kept.join(' ');
};

/**
 * Tidies the punctuation the other rules leave behind.
 *
 * Removing a word from the middle of a sentence leaves ", ," and a leading comma
 * behind it, which a text-to-speech voice reads as a pause and an agent reads as
 * a typo.
 */
const tidy = (text: string): string =>
  text
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/([,;:])\1+/g, '$1')
    .replace(/^[\s,;:]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

/**
 * Every enabled rule, in the order they have to run.
 *
 * Fillers first: "salı ııı pardon çarşamba" only reads as a correction once the
 * hesitation between the word and the cue is gone. Repeats last, because a
 * correction can legitimately produce one — "çarşamba, pardon, çarşamba" is a
 * person confirming rather than correcting, and it should end up said once.
 */
export const applyTranscriptRules = (text: string, rules: TranscriptRules): string => {
  if (text.trim().length === 0) return '';

  let result = text;
  if (rules.removeFillers) result = removeFillers(result, rules);
  if (rules.selfCorrection) result = applySelfCorrection(result);
  if (rules.collapseRepeats) result = collapseRepeats(result);

  const tidied = tidy(result);
  // A rule set that removed everything has misfired; the raw transcript is
  // always better than silence.
  return tidied.length > 0 ? tidied : text.trim();
};
