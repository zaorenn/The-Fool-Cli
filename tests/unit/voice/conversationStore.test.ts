/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendTurn, startConversation } from '@/common/voice/conversationLog';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('@renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: mocks.get,
  setClientBusinessSetting: mocks.set,
}));

import {
  CONVERSATIONS_CONFIG_KEY,
  forgetAllConversations,
  forgetConversation,
  peekConversations,
  readConversations,
  resetConversationCacheForTest,
  saveConversation,
  subscribeConversations,
} from '@renderer/services/voice/session/conversationStore';

const spoken = (id: string, at: number, text: string) => appendTurn(startConversation(id, at), { role: 'user', text });

describe('the conversation store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConversationCacheForTest();
    mocks.get.mockResolvedValue(undefined);
    mocks.set.mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetConversationCacheForTest();
  });

  it('writes a conversation under its own key, not the memory document', async () => {
    // Its own record on purpose: the memory is a short document changed when
    // something is learned, this grows by a line whenever anybody speaks.
    await saveConversation(spoken('a', 1, 'Hello.'));

    expect(mocks.set).toHaveBeenCalledWith(CONVERSATIONS_CONFIG_KEY, expect.anything());
  });

  it('reads back what a previous session saved', async () => {
    mocks.get.mockResolvedValue({
      conversations: [{ id: 'a', startedAtMs: 1, title: 'Hello.', turns: [{ role: 'user', text: 'Hello.' }] }],
    });

    const log = await readConversations();

    expect(log.conversations.map((c) => c.title)).toEqual(['Hello.']);
  });

  it('keeps a conversation for this session even when the write fails', async () => {
    // A backend that is not answering must not lose the sentence just spoken;
    // the next successful write carries it.
    mocks.set.mockRejectedValue(new Error('backend is down'));

    await saveConversation(spoken('a', 1, 'Hello.'));

    expect(peekConversations().conversations.map((c) => c.id)).toEqual(['a']);
  });

  it('does not let an unreachable backend stop someone talking', async () => {
    mocks.get.mockRejectedValue(new Error('backend is down'));

    await expect(readConversations()).resolves.toEqual({ conversations: [] });
  });

  it('replaces a growing conversation rather than filling the list with copies', async () => {
    const first = spoken('a', 1, 'One.');
    await saveConversation(first);
    await saveConversation(appendTurn(first, { role: 'assistant', text: 'Two.' }));

    const log = peekConversations();
    expect(log.conversations).toHaveLength(1);
    expect(log.conversations[0].turns).toHaveLength(2);
  });

  it('tells the panel when something changes, without it having to poll', async () => {
    const seen: number[] = [];
    const release = subscribeConversations((log) => seen.push(log.conversations.length));

    await saveConversation(spoken('a', 1, 'One.'));
    await saveConversation(spoken('b', 2, 'Two.'));
    release();
    await saveConversation(spoken('c', 3, 'Three.'));

    expect(seen).toEqual([1, 2]);
  });

  it('forgets one and forgets all', async () => {
    await saveConversation(spoken('a', 1, 'One.'));
    await saveConversation(spoken('b', 2, 'Two.'));

    expect((await forgetConversation('a')).conversations.map((c) => c.id)).toEqual(['b']);
    expect((await forgetAllConversations()).conversations).toEqual([]);
  });
});
