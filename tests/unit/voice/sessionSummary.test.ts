/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { describeSpokenTurns, worthRemembering, type SpokenTurn } from '@/common/voice/sessionSummary';

/**
 * The line a conversation leaves behind when there is no model to write it.
 *
 * Only the local pipeline could write a summary, because only it has a model on
 * the same machine to ask. So a conversation held over OpenAI Realtime or Gemini
 * Live — the providers someone paying for this would use — was forgotten
 * entirely, which is the wrong way round.
 */

const turns = (...lines: [SpokenTurn['role'], string][]): SpokenTurn[] => lines.map(([role, text]) => ({ role, text }));

describe('worthRemembering', () => {
  it('takes one question for what it is, and does not file it as a conversation', () => {
    expect(worthRemembering(turns(['user', 'what time is it'], ['assistant', 'Half four.']))).toBe(false);
  });

  it('counts what the user said, not what was said back to them', () => {
    expect(
      worthRemembering(turns(['assistant', 'one'], ['assistant', 'two'], ['assistant', 'three'], ['user', 'hi']))
    ).toBe(false);
  });

  it('remembers a conversation that was one', () => {
    expect(
      worthRemembering(turns(['user', 'the installer fails'], ['assistant', 'ok'], ['user', 'still failing']))
    ).toBe(true);
  });
});

describe('describeSpokenTurns', () => {
  it('says where it started and where it ended up, which is how people describe one', () => {
    const summary = describeSpokenTurns(
      turns(['user', 'the installer fails'], ['assistant', 'ok'], ['user', 'it works now, thanks'])
    );

    expect(summary).toBe('the installer fails … it works now, thanks');
  });

  it('does not repeat itself when the conversation had one subject', () => {
    expect(describeSpokenTurns(turns(['user', 'the installer fails'], ['assistant', 'ok']))).toBe(
      'the installer fails'
    );
  });

  it('stays within a line, so a rambling opening cannot crowd out the ending', () => {
    const summary = describeSpokenTurns(turns(['user', 'a'.repeat(400)], ['user', 'b'.repeat(400)]));

    expect(summary.length).toBeLessThanOrEqual(240);
    expect(summary).toContain('b');
  });

  it('has nothing to say about a conversation with nothing in it', () => {
    expect(describeSpokenTurns(turns(['assistant', 'hello?']))).toBe('');
  });
});
