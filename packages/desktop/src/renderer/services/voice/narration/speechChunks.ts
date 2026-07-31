/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cutting a passage into clips that can be spoken one after another.
 *
 * Synthesis is offline: nothing is heard until the whole passage has been
 * rendered, so a long answer is a long silence followed by a long clip. That
 * silence is the whole of "the cloned voice is slow" — the engine is not slow
 * per second of speech, it is simply asked for all of them before any of them
 * plays.
 *
 * Cutting the passage up turns the wait into the time it takes to render the
 * first sentence, and the rest is rendered while that one is playing. The first
 * chunk is deliberately the smallest for exactly that reason; later ones run
 * longer, because a chunk boundary costs a breath and there is no need to pay it
 * every sentence once speech is already flowing.
 */

export type SpeechChunkOptions = {
  /** Kept short: this one is the wait before anything is heard. */
  firstChunkCharacters?: number;
  /** Later chunks, which are rendered while the previous one plays. */
  chunkCharacters?: number;
};

/**
 * Measured against the cloning engine, which is the slow one: a clause of this
 * length renders in roughly a second, which is about as long as a wait can be
 * before it reads as a fault rather than a pause.
 */
const DEFAULT_FIRST_CHUNK_CHARACTERS = 120;

/**
 * Long enough that the boundaries are rare, short enough that the next clip is
 * always ready before the current one ends.
 */
const DEFAULT_CHUNK_CHARACTERS = 320;

/** End of sentence, plus the space that follows it. */
const SENTENCE_END = /[.!?…]["')\]]?\s/g;

/** Somewhere to breathe inside a sentence that is too long to render at once. */
const CLAUSE_END = /[,;:—]\s/g;

/**
 * The offsets a passage may be cut at, nearest the end of the budget first.
 *
 * Sentence ends are preferred over clause ends, and clause ends over plain word
 * boundaries, so a chunk break lands where a speaker would have paused anyway.
 */
const breakPointsWithin = (text: string, limit: number): number[] => {
  const window = text.slice(0, limit + 1);
  const offsets: number[] = [];

  for (const pattern of [SENTENCE_END, CLAUSE_END]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(window)) !== null) offsets.push(match.index + match[0].length);
    // A boundary of this rank was found; a weaker one would be a worse cut.
    if (offsets.length > 0) return offsets;
  }

  const lastSpace = window.lastIndexOf(' ');
  return lastSpace > 0 ? [lastSpace + 1] : [];
};

/**
 * Splits a passage into clips to be synthesised and played in order.
 *
 * Joining the result with single spaces gives the passage back: speech must not
 * quietly lose a sentence because it fell on a boundary.
 */
export const splitForSpeech = (text: string, options: SpeechChunkOptions = {}): string[] => {
  const firstChunkCharacters = options.firstChunkCharacters ?? DEFAULT_FIRST_CHUNK_CHARACTERS;
  const chunkCharacters = options.chunkCharacters ?? DEFAULT_CHUNK_CHARACTERS;

  let rest = text.trim();
  if (rest.length === 0) return [];

  const chunks: string[] = [];
  while (rest.length > 0) {
    const limit = chunks.length === 0 ? firstChunkCharacters : chunkCharacters;
    if (rest.length <= limit) {
      chunks.push(rest);
      break;
    }

    const offsets = breakPointsWithin(rest, limit);
    const cut = offsets.length > 0 ? offsets[offsets.length - 1] : 0;
    // Nothing to cut at — one word longer than the whole budget. Speaking it
    // whole is right; splitting it would be heard as a stutter.
    if (cut === 0) {
      chunks.push(rest);
      break;
    }

    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  return chunks.filter((chunk) => chunk.length > 0);
};
