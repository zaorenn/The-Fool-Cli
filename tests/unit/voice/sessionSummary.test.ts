/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  CONTINUITY_MAX_DAYS,
  continuityFor,
  describeSpokenTurns,
  lastSession,
  worthRemembering,
  type SpokenTurn,
} from '@/common/voice/sessionSummary';
import { rememberSession } from '@/common/voice/memory';

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

/**
 * Picking the line back up, which is the half that is actually felt.
 *
 * Writing a session down changes nothing the user notices. Knowing what they
 * were doing yesterday is the whole difference between an assistant and a search
 * box — and it is assembled here, from the stored line, rather than asked of a
 * model, because a model told to mention last session will mention one whether
 * or not there was one, and will improve on it.
 */
describe('what to open a conversation with', () => {
  const emptyMemory = { user: '', agent: '', introduced: true };
  const on = (iso: string) => new Date(`${iso}T09:00:00`);

  /// Written through `rememberSession` rather than by hand, so the reader and
  /// the writer cannot drift apart on the format. Handwritten fixtures are how
  /// a parser ends up passing its tests against a shape nothing produces.
  const withSession = (summary: string, day: string): string => rememberSession(emptyMemory, summary, on(day)).user;

  it('finds the session that was written down', () => {
    const doc = withSession('the installer', '2026-08-11');
    expect(lastSession(doc)).toEqual({ day: '2026-08-11', summary: 'the installer' });
  });

  it('takes the newest when there are several', () => {
    let doc = emptyMemory;
    doc = rememberSession(doc, 'the installer', on('2026-08-09'));
    doc = rememberSession(doc, 'the voice gate', on('2026-08-11'));
    expect(lastSession(doc.user)?.summary).toBe('the voice gate');
  });

  it('opens with yesterday as something recent', () => {
    const opener = continuityFor(withSession('the installer', '2026-08-11'), on('2026-08-12'));
    expect(opener).toEqual({ when: 'recent', summary: 'the installer' });
  });

  it('calls a week ago older, rather than pretending it was yesterday', () => {
    expect(continuityFor(withSession('the installer', '2026-08-05'), on('2026-08-12'))?.when).toBe('older');
  });

  /// Past a fortnight this is not continuity — it is bringing up something the
  /// user finished and forgot, which reads as not having paid attention since.
  it('says nothing about a conversation older than the limit', () => {
    const long = new Date(2026, 7, 12 - CONTINUITY_MAX_DAYS - 1);
    const doc = rememberSession(emptyMemory, 'the installer', long).user;
    expect(continuityFor(doc, on('2026-08-12'))).toBeNull();
  });

  /// `null` is the common answer and has to be, because an assistant reaching
  /// for continuity it does not have produces the invented sentence this whole
  /// approach exists to avoid.
  it('says nothing when there is nothing to say', () => {
    expect(continuityFor('', on('2026-08-12'))).toBeNull();
    expect(continuityFor('## What we have talked about\n\n- not a dated line\n', on('2026-08-12'))).toBeNull();
  });

  it('says nothing when the clock has gone backwards', () => {
    expect(continuityFor(withSession('the installer', '2026-08-20'), on('2026-08-12'))).toBeNull();
  });
});
