/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored = new Map<string, unknown>();
const subscribers = new Map<string, Set<(value: unknown) => void>>();

vi.mock('@/common', () => ({
  ipcBridge: { conversation: { get: { invoke: () => Promise.resolve({ id: 'conv-1' }) } } },
}));

vi.mock('@/common/config/configService', () => ({
  configService: {
    get: (key: string) => stored.get(key),
    set: (key: string, value: unknown) => {
      if (value === undefined) stored.delete(key);
      else stored.set(key, value);
      for (const notify of subscribers.get(key) ?? []) notify(value);
      return Promise.resolve();
    },
    subscribe: (key: string, callback: (value: unknown) => void) => {
      if (!subscribers.has(key)) subscribers.set(key, new Set());
      subscribers.get(key)!.add(callback);
      return () => subscribers.get(key)?.delete(callback);
    },
  },
}));

const { useVoiceBoundConversation } = await import('@renderer/hooks/voice/useVoiceBoundConversation');

let api: ReturnType<typeof useVoiceBoundConversation> | null = null;

const Harness: React.FC = () => {
  api = useVoiceBoundConversation();
  return null;
};

describe('useVoiceBoundConversation', () => {
  beforeEach(() => {
    stored.clear();
    subscribers.clear();
    api = null;
  });

  it('starts with nothing bound', () => {
    render(<Harness />);

    expect(api?.conversationId).toBeNull();
    expect(api?.isBound('conv-1')).toBe(false);
  });

  it('binds a chat and reports it', () => {
    render(<Harness />);

    act(() => api?.bind('conv-1'));

    expect(api?.conversationId).toBe('conv-1');
    expect(api?.isBound('conv-1')).toBe(true);
  });

  it('holds exactly one chat, so setting another releases the first', () => {
    render(<Harness />);

    act(() => api?.bind('conv-1'));
    act(() => api?.bind('conv-2'));

    expect(api?.isBound('conv-1')).toBe(false);
    expect(api?.isBound('conv-2')).toBe(true);
  });

  it('releases the chat when the same one is chosen again', () => {
    render(<Harness />);

    act(() => api?.toggle('conv-1'));
    expect(api?.conversationId).toBe('conv-1');

    act(() => api?.toggle('conv-1'));
    expect(api?.conversationId).toBeNull();
  });

  it('follows the binding when the wake word moves it', () => {
    // The list has to follow: a spoken turn that opens a new chat rebinds it.
    render(<Harness />);

    act(() => {
      stored.set('voice.boundConversationId', 'conv-9');
      for (const notify of subscribers.get('voice.boundConversationId') ?? []) notify('conv-9');
    });

    expect(api?.conversationId).toBe('conv-9');
  });
});
