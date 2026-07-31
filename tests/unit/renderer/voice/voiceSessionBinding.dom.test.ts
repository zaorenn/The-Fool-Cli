/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored = new Map<string, unknown>();
const conversationGet = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: { conversation: { get: { invoke: (params: { id: string }) => conversationGet(params) } } },
}));

vi.mock('@/common/config/configService', () => ({
  configService: {
    get: (key: string) => stored.get(key),
    set: (key: string, value: unknown) => {
      if (value === undefined) stored.delete(key);
      else stored.set(key, value);
      return Promise.resolve();
    },
  },
}));

const {
  bindConversation,
  boundConversationId,
  isNewSessionRequested,
  requestNewSession,
  resolveBoundConversation,
  resetVoiceSessionBinding,
  shouldStartNewSession,
} = await import('@renderer/services/voice/session/voiceSessionBinding');

describe('voiceSessionBinding', () => {
  beforeEach(() => {
    stored.clear();
    conversationGet.mockReset();
    conversationGet.mockResolvedValue({ id: 'conv-1' });
    resetVoiceSessionBinding();
  });

  it('has nothing bound before the first spoken turn', async () => {
    expect(boundConversationId()).toBeNull();
    expect(shouldStartNewSession()).toBe(true);
    expect(await resolveBoundConversation()).toBeNull();
  });

  it('keeps every later wake in the same chat', async () => {
    bindConversation('conv-1');

    expect(shouldStartNewSession()).toBe(false);
    expect(await resolveBoundConversation()).toBe('conv-1');
    expect(await resolveBoundConversation()).toBe('conv-1');
  });

  it('starts one new chat when the user asks for one, then settles again', async () => {
    bindConversation('conv-1');
    requestNewSession();

    expect(isNewSessionRequested()).toBe(true);
    expect(await resolveBoundConversation()).toBeNull();

    bindConversation('conv-2');
    expect(isNewSessionRequested()).toBe(false);
    expect(await resolveBoundConversation()).toBe('conv-2');
  });

  it('replaces the binding rather than holding two chats at once', async () => {
    bindConversation('conv-1');
    bindConversation('conv-2');

    expect(boundConversationId()).toBe('conv-2');
  });

  it('drops a binding whose chat has been deleted', async () => {
    bindConversation('conv-1');
    conversationGet.mockResolvedValue(null);

    expect(await resolveBoundConversation()).toBeNull();
    // Cleared, so the next turn does not pay for the same lookup again.
    expect(boundConversationId()).toBeNull();
  });

  it('keeps the binding when the backend cannot be reached', async () => {
    // An offline moment is not a reason to abandon the conversation.
    bindConversation('conv-1');
    conversationGet.mockRejectedValue(new Error('unreachable'));

    expect(await resolveBoundConversation()).toBe('conv-1');
    expect(boundConversationId()).toBe('conv-1');
  });
});
