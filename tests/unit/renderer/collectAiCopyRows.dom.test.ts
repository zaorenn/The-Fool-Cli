/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the copy button under an AI reply actually copies.
 *
 * An answer interrupted by a tool call is stored as several text messages. The
 * row sits under the last one, and it used to copy that one — so a user who
 * copied an explanation got everything after the final tool call and nothing
 * before it. Silent, and worse than copying nothing, because the fragment reads
 * like a complete answer.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { collectAiCopyRows } from '@renderer/pages/conversation/Messages/MessageList';
import { joinTurnTexts } from '@renderer/pages/conversation/Messages/components/MessageText';

const ai = (id: string, content: string) => ({ id, type: 'text', position: 'left', content: { content } });
const user = (id: string) => ({ id, type: 'text', position: 'right', content: { content: 'ask' } });
const tool = (id: string) => ({ id, type: 'tool_summary', sourceMessageIds: [], created_at: 0 });
const thinking = (id: string) => ({ id, type: 'thinking', position: 'left', content: { content: 'hmm' } });

describe('collectAiCopyRows', () => {
  it('puts the row under the turn’s last text', () => {
    const rows = collectAiCopyRows([ai('a', 'one'), tool('t'), ai('b', 'two')], false);

    expect([...rows.keys()]).toEqual(['b']);
  });

  it('collects every text in the turn, not only the one the row sits on', () => {
    const rows = collectAiCopyRows([ai('a', 'one'), tool('t'), ai('b', 'two')], false);

    expect(rows.get('b')?.texts).toEqual(['one', 'two']);
  });

  it('does not let a tool call end a turn', () => {
    const rows = collectAiCopyRows([ai('a', 'one'), tool('t1'), tool('t2'), ai('b', 'two')], false);

    expect(rows.size).toBe(1);
  });

  it('ends a turn at the next user message', () => {
    const rows = collectAiCopyRows([ai('a', 'one'), user('u'), ai('b', 'two')], false);

    expect(rows.get('a')?.texts).toEqual(['one']);
    expect(rows.get('b')?.texts).toEqual(['two']);
  });

  it('ignores messages that are not text, so thinking is never copied', () => {
    const rows = collectAiCopyRows([thinking('t'), ai('a', 'one')], false);

    expect(rows.get('a')?.texts).toEqual(['one']);
  });

  it('withholds the last turn’s row while the reply is still arriving', () => {
    const streaming = collectAiCopyRows([ai('a', 'one'), user('u'), ai('b', 'two')], true);

    expect(streaming.has('b')).toBe(false);
    // A turn that already finished keeps its row.
    expect(streaming.has('a')).toBe(true);
  });

  it('produces nothing for a conversation with no AI text yet', () => {
    expect(collectAiCopyRows([user('u')], false).size).toBe(0);
    expect(collectAiCopyRows([], false).size).toBe(0);
  });
});

describe('joinTurnTexts', () => {
  it('separates the segments a tool call had separated on screen', () => {
    expect(joinTurnTexts(['one', 'two'])).toBe('one\n\ntwo');
  });

  it('drops the thinking a segment was rendered without', () => {
    expect(joinTurnTexts(['<think>private</think>answer'])).toBe('answer');
  });

  it('drops an empty segment rather than copying blank lines', () => {
    expect(joinTurnTexts(['one', '   ', 'two'])).toBe('one\n\ntwo');
  });

  it('is empty when the turn produced nothing readable', () => {
    expect(joinTurnTexts(['', '  '])).toBe('');
  });
});
