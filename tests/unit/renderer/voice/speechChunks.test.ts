/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { splitForSpeech } from '@renderer/services/voice/narration/speechChunks';

/** Rejoining the chunks must give back the passage, or speech has lost words. */
const rejoin = (chunks: string[]) => chunks.join(' ');

describe('splitForSpeech', () => {
  it('leaves a passage that is already short as one chunk', () => {
    expect(splitForSpeech('I updated the login form.')).toEqual(['I updated the login form.']);
  });

  it('returns nothing for text with nothing in it', () => {
    expect(splitForSpeech('   ')).toEqual([]);
  });

  // The point of chunking: the first clip is short, so speech starts while the
  // rest is still being synthesised.
  it('breaks a long passage at sentence ends', () => {
    const chunks = splitForSpeech('First sentence here. Second sentence here. Third sentence here.', {
      firstChunkCharacters: 25,
      chunkCharacters: 25,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk).toMatch(/[.!?]$/);
  });

  it('keeps every word, in order', () => {
    const passage =
      'I read the config file. Then I changed the timeout to thirty seconds. ' +
      'The tests pass now, all forty of them. Nothing else was touched.';
    const chunks = splitForSpeech(passage, { firstChunkCharacters: 30, chunkCharacters: 40 });

    expect(rejoin(chunks)).toBe(passage);
  });

  it('starts with a short chunk and lets later ones run longer', () => {
    const passage = Array.from({ length: 12 }, (_, index) => `Sentence number ${index} is here.`).join(' ');
    const chunks = splitForSpeech(passage, { firstChunkCharacters: 40, chunkCharacters: 160 });

    expect(chunks[0].length).toBeLessThanOrEqual(40);
    expect(chunks[1].length).toBeGreaterThan(40);
  });

  // A sentence longer than the budget still has to be spoken, and a clause
  // boundary is a better place to breathe than an arbitrary character.
  it('breaks an over-long sentence at a clause boundary', () => {
    const passage =
      'I changed the reader, the writer, the parser, the formatter, the linter, and the bundler, ' +
      'then ran everything again.';
    const chunks = splitForSpeech(passage, { firstChunkCharacters: 40, chunkCharacters: 40 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(rejoin(chunks)).toBe(passage);
  });

  // No clause boundary either: a word boundary, because splitting mid-word is
  // heard as a stutter.
  it('never splits inside a word', () => {
    const passage = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll';
    const chunks = splitForSpeech(passage, { firstChunkCharacters: 12, chunkCharacters: 12 });

    expect(rejoin(chunks)).toBe(passage);
    for (const chunk of chunks) expect(chunk).not.toMatch(/^\s|\s$/);
  });

  it('handles a single word longer than the whole budget', () => {
    const passage = 'antidisestablishmentarianism';
    expect(splitForSpeech(passage, { firstChunkCharacters: 5, chunkCharacters: 5 })).toEqual([passage]);
  });

  it('treats question and exclamation marks as sentence ends', () => {
    const chunks = splitForSpeech('Did it work? It did! Good news all round.', {
      firstChunkCharacters: 15,
      chunkCharacters: 15,
    });

    expect(chunks[0]).toBe('Did it work?');
  });
});
