/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One short line for the notch, out of a reply that is still being written.
 *
 * The notch is a strip a few centimetres wide floating over whatever the user
 * is actually doing. It was being handed the assistant's entire streaming
 * reply, so it grew into a wall of text — and, when the agent's own output came
 * through, a list of markdown fragments: a stray backtick, the word `Command`,
 * `tool`, `for`, `this`, each on its own line. Nothing there told the user what
 * was happening, which is the only thing that strip is for.
 *
 * So it gets the first sentence, cleaned and capped. Not a summary: summarising
 * would need a model, and this has to be right on every frame of a stream.
 */

/** About as much as fits without the strip growing into a paragraph. */
const LIMIT = 90;

/**
 * Markdown taken back down to what it says.
 *
 * Fenced code goes entirely — a shell command scrolling through the notch is
 * both unreadable and alarming, and the activity list already names the tool
 * that is running.
 */
const flatten = (text: string): string =>
  text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*|__|~~/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * A sentence boundary: the punctuation, and the space or the end after it.
 *
 * The whitespace is required so that `3.14` and an `e.g.` mid-sentence are not
 * read as the end of one.
 */
const BOUNDARY = /[.!?…]+(?:\s+|$)/g;

/**
 * The sentence being written, rather than the first one that was.
 *
 * This runs on every frame of a stream, against everything received so far. So
 * taking the *first* sentence meant that the moment one finished the strip
 * stopped moving: the assistant would be four sentences further on and the
 * notch still showed the opening words. A strip whose entire purpose is to say
 * what is happening was reliably reporting what had already happened.
 *
 * What it shows now is the fragment after the last completed sentence while one
 * is in progress, and the last completed sentence once the reply stops. Still
 * one sentence and still capped, so the wall of text this function exists to
 * prevent cannot come back in through here.
 */
const currentSentence = (flat: string): string => {
  BOUNDARY.lastIndex = 0;
  let start = 0;

  for (let match = BOUNDARY.exec(flat); match !== null; match = BOUNDARY.exec(flat)) {
    const end = match.index + match[0].length;
    // The reply ends on this boundary, so the sentence it closes is the newest
    // thing there is to show.
    if (end >= flat.length) break;
    start = end;
  }

  return flat.slice(start).trim();
};

/**
 * How much of a reply is looked at.
 *
 * This runs on every frame of a stream, against everything received so far —
 * so the work per frame grows with the answer, and the work per answer grows
 * with its square. On a reply of a few thousand characters that is a
 * meaningful amount of regex over text the function is about to discard
 * anyway, on the thread that is also drawing the meter.
 *
 * Only the tail can ever be the answer: what comes out is the sentence in
 * progress, capped at {@link LIMIT}. This is generously more than a sentence,
 * so the result is the same one the whole reply produced — with one exception,
 * an unbroken block of prose longer than this with no sentence end in it, which
 * is cut at a word either way.
 */
const TAIL = 600;

/**
 * One line for the notch, following the reply as it is written.
 *
 * Cut at a word rather than mid-syllable, because this is read at a glance and
 * a truncated word reads as a glitch.
 */
export const notchLine = (reply: string): string => {
  // Taken before flattening rather than after: flattening is the expensive half
  // and there is no reason to do it to a paragraph that cannot be shown. The
  // extra character is what tells `currentSentence` the text was cut, so a
  // truncated opening is not mistaken for a completed sentence.
  const tail = reply.length > TAIL ? reply.slice(-TAIL) : reply;
  const flat = flatten(tail);
  if (flat.length === 0) return '';

  const sentence = currentSentence(flat);
  if (sentence.length <= LIMIT) return sentence;

  const cut = sentence.slice(0, LIMIT);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > LIMIT - 25 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};
