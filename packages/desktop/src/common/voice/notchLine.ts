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
 * The first sentence of a reply, or as much of it as has arrived.
 *
 * Cut at a word rather than mid-syllable, because this is read at a glance and
 * a truncated word reads as a glitch.
 */
export const notchLine = (reply: string): string => {
  const flat = flatten(reply);
  if (flat.length === 0) return '';

  const end = flat.search(/[.!?…]\s|[.!?…]$/);
  const sentence = end === -1 ? flat : flat.slice(0, end + 1);
  if (sentence.length <= LIMIT) return sentence;

  const cut = sentence.slice(0, LIMIT);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > LIMIT - 25 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};
