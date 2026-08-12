/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The curiosity layer, as the conversation uses it.
 *
 * `openSubjects` and `mayAskAbout` were written, tested and called by nothing —
 * an assistant designed to get to know somebody that never asked them anything.
 * The unit tests beside this one cover the rules; these cover the composition
 * the runtime performs, which is where a wiring like this goes wrong: the wrong
 * subject chosen, a refusal that does not stick, or a question asked twice.
 */

import { describe, expect, it } from 'vitest';
import {
  CURIOSITY_REFUSALS_CONFIG_KEY,
  QUESTIONS_PER_SESSION,
  WORTH_KNOWING,
  mayAskAbout,
  openSubjects,
  sanitizeRefusedSubjects,
} from '@/common/voice/memoryProposal';
import { maySpeakUnprompted } from '@/common/voice/thinkingAloud';

const EMPTY_MEMORY = { user: '', agent: '' };
const askedKey = (id: string): string => `curiosity:${id}`;

/** The composition the runtime performs, without the runtime. */
const wouldAsk = (options: {
  memory?: { user: string; agent: string };
  refused?: string[];
  askedThisSession?: number;
  phase?: string;
  standby?: boolean;
  hushed?: boolean;
  quietForMs?: number;
}): string | null => {
  const memory = options.memory ?? EMPTY_MEMORY;
  const refused = new Set(sanitizeRefusedSubjects(options.refused ?? []));
  const askedThisSession = options.askedThisSession ?? 0;
  const phase = options.phase ?? 'listening';

  const subject = openSubjects(memory, [...refused])[0];
  if (!subject) return null;

  if (
    !mayAskAbout({
      subject: subject.id,
      askedThisSession,
      midTask: phase !== 'listening' || (options.standby ?? false),
      refusedSubjects: refused,
    })
  ) {
    return null;
  }

  const verdict = maySpeakUnprompted({
    reason: 'curiosity',
    about: askedKey(subject.id),
    enabled: true,
    hushed: options.hushed ?? false,
    phase,
    standby: options.standby ?? false,
    holdingToTalk: false,
    userIsTyping: false,
    quietForMs: options.quietForMs ?? 10_000,
    sinceVolunteeredMs: askedThisSession > 0 ? 0 : Number.POSITIVE_INFINITY,
    volunteeredInLastHour: askedThisSession,
    alreadySaid: new Set([...refused].map(askedKey)),
  });

  return verdict.speak ? subject.id : null;
};

describe('what the conversation would ask', () => {
  it('asks about something when it knows nothing at all', () => {
    expect(wouldAsk({})).not.toBeNull();
  });

  it('asks the first subject still unanswered, in the catalogue’s order', () => {
    expect(wouldAsk({})).toBe(WORTH_KNOWING[0].id);
  });

  it('skips a subject the memory already answers', () => {
    const memory = { user: '- Called: Serhan\n', agent: '' };

    expect(wouldAsk({ memory })).not.toBe('name');
  });

  it('asks nothing once the memory answers everything it wanted to know', () => {
    const answersEverything = WORTH_KNOWING.map((subject) => subject.answeredBy[0]).join('\n');

    expect(wouldAsk({ memory: { user: answersEverything, agent: '' } })).toBeNull();
  });

  it('never asks a subject that has had its turn', () => {
    const first = wouldAsk({});

    expect(first).not.toBeNull();
    expect(wouldAsk({ refused: [first as string] })).not.toBe(first);
  });

  it('asks nothing at all once every subject has had its turn', () => {
    const all = WORTH_KNOWING.map((subject) => subject.id);

    expect(wouldAsk({ refused: all })).toBeNull();
  });
});

describe('when it stays quiet', () => {
  it('does not ask a second time in one conversation', () => {
    expect(wouldAsk({ askedThisSession: QUESTIONS_PER_SESSION })).toBeNull();
  });

  it('does not ask while a task is running', () => {
    expect(wouldAsk({ phase: 'acting' })).toBeNull();
  });

  it('does not ask while the reply is still being spoken', () => {
    expect(wouldAsk({ phase: 'speaking' })).toBeNull();
  });

  it('does not ask of somebody who asked for quiet', () => {
    expect(wouldAsk({ hushed: true })).toBeNull();
  });

  it('does not ask into a pause that has only just started', () => {
    expect(wouldAsk({ quietForMs: 100 })).toBeNull();
  });

  it('does not ask while waiting on standby', () => {
    expect(wouldAsk({ standby: true })).toBeNull();
  });
});

describe('the refusal store', () => {
  it('is named once, so both halves agree where it lives', () => {
    expect(CURIOSITY_REFUSALS_CONFIG_KEY).toBe('voice.curiosityRefusals');
  });

  it('survives a corrupted value without silencing every question', () => {
    expect(sanitizeRefusedSubjects('not an array')).toEqual([]);
    expect(sanitizeRefusedSubjects([1, null, {}])).toEqual([]);
  });

  it('drops a subject that is no longer in the catalogue', () => {
    expect(sanitizeRefusedSubjects(['name', 'a-subject-we-removed'])).toEqual(['name']);
  });
});
