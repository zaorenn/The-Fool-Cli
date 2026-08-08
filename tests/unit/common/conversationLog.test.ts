/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_CONVERSATION_LOG,
  MAX_CONVERSATIONS,
  MAX_TURNS_PER_CONVERSATION,
  appendTurn,
  pruneConversations,
  removeConversation,
  resumedTurns,
  sanitizeConversationLog,
  startConversation,
  titleFor,
  upsertConversation,
  type VoiceConversation,
} from '@/common/voice/conversationLog';

const conversationWith = (id: string, startedAtMs: number, turns: { role: 'user' | 'assistant'; text: string }[]) =>
  turns.reduce(appendTurn, startConversation(id, startedAtMs));

describe('titleFor', () => {
  it('names a conversation after the first thing the user said', () => {
    expect(
      titleFor([
        { role: 'assistant', text: 'Of course, one moment.' },
        { role: 'user', text: 'What is the weather like?' },
      ])
    ).toBe('What is the weather like?');
  });

  it('leaves a conversation with nothing said in it unnamed', () => {
    // Not given the time for a name: the list shows the time in its own column,
    // and a title repeating it is a row that says one thing twice.
    expect(titleFor([{ role: 'assistant', text: 'Hello?' }])).toBe('');
    expect(titleFor([])).toBe('');
  });

  it('cuts a long opening at a word rather than mid-syllable', () => {
    const title = titleFor([{ role: 'user', text: `${'situation '.repeat(12)}end` }]);

    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toMatch(/situatio…$/);
    expect(title.length).toBeLessThanOrEqual(71);
  });

  it('flattens the whitespace a spoken transcript arrives with', () => {
    expect(titleFor([{ role: 'user', text: '  play   my\n favourite song  ' }])).toBe('play my favourite song');
  });
});

describe('appendTurn', () => {
  it('keeps what was said and titles the conversation as it goes', () => {
    const conversation = conversationWith('a', 1, [
      { role: 'user', text: 'Play my favourite song.' },
      { role: 'assistant', text: 'Playing it now.' },
    ]);

    expect(conversation.turns).toHaveLength(2);
    expect(conversation.title).toBe('Play my favourite song.');
  });

  it('ignores an empty turn rather than storing a blank line', () => {
    const conversation = appendTurn(startConversation('a', 1), { role: 'user', text: '   ' });

    expect(conversation.turns).toEqual([]);
  });

  it('does not rename a conversation once it has a name', () => {
    const conversation = conversationWith('a', 1, [
      { role: 'user', text: 'First question.' },
      { role: 'user', text: 'Second question.' },
    ]);

    expect(conversation.title).toBe('First question.');
  });

  it('drops the oldest turns rather than growing without a bound', () => {
    const many = Array.from({ length: MAX_TURNS_PER_CONVERSATION + 10 }, (_, index) => ({
      role: 'user' as const,
      text: `turn ${index}`,
    }));
    const conversation = many.reduce(appendTurn, startConversation('a', 1));

    expect(conversation.turns).toHaveLength(MAX_TURNS_PER_CONVERSATION);
    expect(conversation.turns.at(-1)?.text).toBe(`turn ${MAX_TURNS_PER_CONVERSATION + 9}`);
  });
});

describe('pruneConversations', () => {
  it('throws away a conversation nobody said anything in', () => {
    // Pressing the key and changing your mind is not history. Kept, those rows
    // would fill the list and open onto nothing.
    const empty = startConversation('empty', 2);
    const real = conversationWith('real', 1, [{ role: 'user', text: 'Hello.' }]);

    expect(pruneConversations([empty, real]).map((c) => c.id)).toEqual(['real']);
  });

  it('puts the newest first', () => {
    const older = conversationWith('older', 1, [{ role: 'user', text: 'One.' }]);
    const newer = conversationWith('newer', 9, [{ role: 'user', text: 'Two.' }]);

    expect(pruneConversations([older, newer]).map((c) => c.id)).toEqual(['newer', 'older']);
  });

  it('keeps only as many as the cap allows', () => {
    const many: VoiceConversation[] = Array.from({ length: MAX_CONVERSATIONS + 5 }, (_, index) =>
      conversationWith(`c${index}`, index, [{ role: 'user', text: 'Hello.' }])
    );

    expect(pruneConversations(many)).toHaveLength(MAX_CONVERSATIONS);
  });
});

describe('upsertConversation', () => {
  it('replaces an earlier version of the same conversation instead of duplicating it', () => {
    const first = conversationWith('a', 1, [{ role: 'user', text: 'One.' }]);
    const grown = appendTurn(first, { role: 'assistant', text: 'Two.' });

    const log = upsertConversation(upsertConversation(EMPTY_CONVERSATION_LOG, first), grown);

    expect(log.conversations).toHaveLength(1);
    expect(log.conversations[0].turns).toHaveLength(2);
  });
});

describe('removeConversation', () => {
  it('drops the one asked for and leaves the rest', () => {
    const log = upsertConversation(
      upsertConversation(EMPTY_CONVERSATION_LOG, conversationWith('a', 1, [{ role: 'user', text: 'One.' }])),
      conversationWith('b', 2, [{ role: 'user', text: 'Two.' }])
    );

    expect(removeConversation(log, 'a').conversations.map((c) => c.id)).toEqual(['b']);
  });
});

describe('resumedTurns', () => {
  it('carries the end of a conversation, not the whole of it', () => {
    // This goes into a prompt. A long transcript pushed in whole would crowd
    // out the conversation being had now.
    const many = Array.from({ length: 60 }, (_, index) => ({ role: 'user' as const, text: `turn ${index}` }));
    const conversation = many.reduce(appendTurn, startConversation('a', 1));

    const carried = resumedTurns(conversation, 5);

    expect(carried).toHaveLength(5);
    expect(carried.at(-1)?.text).toBe('turn 59');
  });
});

describe('sanitizeConversationLog', () => {
  it('reads back what was written', () => {
    const log = upsertConversation(
      EMPTY_CONVERSATION_LOG,
      conversationWith('a', 1, [{ role: 'user', text: 'Hello.' }])
    );

    expect(sanitizeConversationLog(JSON.parse(JSON.stringify(log)))).toEqual(log);
  });

  it('answers empty for anything that is not a log', () => {
    expect(sanitizeConversationLog(null)).toEqual(EMPTY_CONVERSATION_LOG);
    expect(sanitizeConversationLog('a string')).toEqual(EMPTY_CONVERSATION_LOG);
    expect(sanitizeConversationLog({ conversations: 'not a list' })).toEqual(EMPTY_CONVERSATION_LOG);
  });

  it('drops an entry it cannot trust rather than repairing it', () => {
    const raw = {
      conversations: [
        { id: '', startedAtMs: 1, turns: [{ role: 'user', text: 'no id' }] },
        { id: 'b', startedAtMs: 'yesterday', turns: [{ role: 'user', text: 'bad time' }] },
        {
          id: 'c',
          startedAtMs: 3,
          turns: [
            { role: 'nobody', text: 'bad role' },
            { role: 'user', text: 'kept' },
          ],
        },
      ],
    };

    const log = sanitizeConversationLog(raw);

    expect(log.conversations.map((c) => c.id)).toEqual(['c']);
    expect(log.conversations[0].turns).toEqual([{ role: 'user', text: 'kept' }]);
  });

  it('names an entry that arrived without a title', () => {
    const log = sanitizeConversationLog({
      conversations: [{ id: 'a', startedAtMs: 1, turns: [{ role: 'user', text: 'What time is it?' }] }],
    });

    expect(log.conversations[0].title).toBe('What time is it?');
  });
});
