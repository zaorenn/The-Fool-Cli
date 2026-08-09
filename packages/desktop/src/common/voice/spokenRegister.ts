/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The difference between reading a reply out and telling somebody what you did.
 *
 * A written answer and a spoken one are not the same answer. On screen, a diff
 * is the most useful thing an agent can hand back; out loud it is
 * `plus const stop equals use callback open paren async` — thirty seconds of
 * noise a person cannot follow, cannot skim, and cannot skip. The turn that
 * fixed three tests said so in a paragraph the eye reads in two seconds and the
 * ear takes a minute and a half on.
 *
 * So a spoken turn has a register, and it is decided by what the turn *did*
 * rather than by how it was phrased:
 *
 * **Chat.** Nothing ran. The reply is the answer, and it is spoken as written —
 * this is a conversation, and paraphrasing somebody's own sentence back at them
 * is worse than saying it.
 *
 * **Work.** Tools ran. What matters out loud is what was done, not the text of
 * what was written: the prose is spoken with its code taken out, and the tools
 * are named once at the end. Somebody who wants the diff is looking at it.
 *
 * Everything here is pure, and none of it asks a model. A narration that cost a
 * round trip would be a pause between finishing the work and saying so, which
 * is the one place in a spoken turn where a pause is least forgivable.
 */

/** Which of the two kinds of turn this is. */
export type SpokenRegister = 'chat' | 'work';

/** What the turn did, as the only thing the register is decided by. */
export const registerFor = (toolsRan: number): SpokenRegister => (toolsRan > 0 ? 'work' : 'chat');

/**
 * A fenced block is never spoken, in either register.
 *
 * Somebody asking a question in the middle of a conversation can still be
 * answered with a snippet on screen; what they cannot be is read it.
 */
const FENCE = /```[\s\S]*?(?:```|$)/g;

/** Inline code, which is usually an identifier and always unsayable. */
const INLINE = /`[^`\n]*`/g;

/** A path with separators in it. Read out, every slash becomes a word. */
const PATH = /(?:[A-Za-z]:)?[\w.-]*(?:[/\\][\w.-]+){2,}/g;

/** A URL. The address bar has it; the ear does not want it. */
const URL = /https?:\/\/\S+/g;

/**
 * A diff line, which is pure punctuation aloud.
 *
 * Narrow on purpose. `- ilk madde` is a bullet, not a removed line, and an
 * earlier version of this took `^[+-]\s` — so every list an assistant read out
 * lost every item in it, silently. A real diff line either carries the `+++` /
 * `---` file header or has no space after the sign.
 */
const DIFF = /^(?:[+-]{3}\s.*|[+-](?=\S).*)$/gm;

/**
 * The punctuation that only appears in code.
 *
 * Counted rather than matched: one bracket in a sentence is a sentence, and a
 * line with four of them and five words is a line of code somebody forgot to
 * fence.
 */
const CODE_MARKS = /[{}();=<>|\\]|=>|::/g;

/**
 * What is left of a piece of text once the unsayable is taken out.
 *
 * Removed rather than described. "Code block" said aloud in the middle of a
 * sentence is a worse interruption than the gap it fills, and the screen has
 * the thing itself.
 */
export const stripForSpeech = (text: string): string =>
  text
    .replace(FENCE, ' ')
    .replace(DIFF, ' ')
    .replace(URL, ' ')
    .replace(INLINE, ' ')
    .replace(PATH, ' ')
    // Bullets and heading marks are shape, not words.
    .replace(/^\s*[*\-#>]+\s*/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

/**
 * Whether what is left is still a sentence, or only the wreckage of one.
 *
 * A line that was mostly code comes out of the strip as a few connecting
 * words — "and then to the", "in the file" — and saying those is worse than
 * saying nothing, because it sounds like the assistant losing its thread.
 *
 * Judged on what survived rather than on what was there: a sentence with one
 * identifier in it is a sentence, and a sentence that *is* identifiers is not.
 */
export const isSayable = (original: string, stripped: string): boolean => {
  if (stripped.length === 0) return false;

  const words = stripped.split(/\s+/).filter((word) => /\p{L}/u.test(word));
  if (words.length < 2) return false;

  // A line of code that nobody fenced. Nothing above removes it — there is no
  // marker to find — so it is recognised by what it is made of: brackets,
  // assignment and terminators, in a line too short to be prose.
  const marks = (stripped.match(CODE_MARKS) ?? []).length;
  if (marks >= 3 && words.length <= 8) return false;

  // More than half of it disappeared, and what is left is short: this was a
  // line about code with a few words wrapped round it.
  const survived = stripped.length / Math.max(1, original.trim().length);
  return survived > 0.45 || words.length >= 6;
};

/**
 * One line for a whole turn's worth of work.
 *
 * Names the tools rather than counting them, because "I ran four tools" tells
 * somebody nothing and "I read the file, ran the tests and fixed three" tells
 * them everything they wanted from the paragraph they did not have to hear.
 *
 * Distinct names in the order they first ran, capped: a turn that called the
 * same editor eleven times did one thing, not eleven, and a list that long is
 * another wall of sound.
 */
export const MAX_NARRATED_TOOLS = 4;

export const narrateWork = (toolNames: readonly string[], describe: (name: string) => string): string => {
  const distinct: string[] = [];
  for (const name of toolNames) {
    const label = describe(name).trim();
    if (label.length > 0 && !distinct.includes(label)) distinct.push(label);
  }
  if (distinct.length === 0) return '';

  const shown = distinct.slice(0, MAX_NARRATED_TOOLS);
  return shown.join(', ');
};
