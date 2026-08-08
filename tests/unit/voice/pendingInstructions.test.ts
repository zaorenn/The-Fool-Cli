/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { PendingInstructions, prefaceWithInstructions } from '@/common/voice/pendingInstructions';

describe('PendingInstructions', () => {
  it('hands each instruction to exactly one turn', () => {
    const pending = new PendingInstructions();
    pending.add('Answer in English.');

    expect(pending.takeForNextTurn()).toEqual(['Answer in English.']);
    // Repeating it every turn would spend the whole prompt on things already
    // said, and a small local model reads the newest instruction as the loudest.
    expect(pending.takeForNextTurn()).toEqual([]);
  });

  it('does not keep the same instruction twice', () => {
    const pending = new PendingInstructions();
    pending.add('Answer in English.');
    pending.add('answer in english.');

    expect(pending.takeForNextTurn()).toHaveLength(1);
  });

  it('ignores an empty instruction', () => {
    const pending = new PendingInstructions();
    pending.add('   ');

    expect(pending.takeForNextTurn()).toEqual([]);
  });

  it('keeps them in the order they were given', () => {
    const pending = new PendingInstructions();
    pending.add('Answer in English.');
    pending.add('Never read addresses out.');

    expect(pending.takeForNextTurn()).toEqual(['Answer in English.', 'Never read addresses out.']);
  });

  it('is bounded, so a wedged turn cannot accumulate them forever', () => {
    const pending = new PendingInstructions();
    for (let index = 0; index < 50; index += 1) pending.add(`Rule number ${index}.`);

    const taken = pending.takeForNextTurn();
    expect(taken.length).toBeLessThanOrEqual(10);
    // Oldest dropped rather than newest: the most recent instruction is the one
    // the user is waiting to see obeyed.
    expect(taken.at(-1)).toBe('Rule number 49.');
  });
});

describe('prefaceWithInstructions', () => {
  it('puts the instruction ahead of what was said, marked as an instruction', () => {
    const message = prefaceWithInstructions('what is the weather', ['Answer in English.']);

    expect(message.indexOf('Answer in English.')).toBeLessThan(message.indexOf('what is the weather'));
    expect(message).toContain('what is the weather');
  });

  it('leaves what was said alone when there is nothing pending', () => {
    expect(prefaceWithInstructions('what is the weather', [])).toBe('what is the weather');
  });
});
