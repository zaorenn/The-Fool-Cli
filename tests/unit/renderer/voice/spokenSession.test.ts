/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS } from '@/common/types/foolVoice';

type CreateBody = {
  name?: string;
  extra?: { system_prompt?: string; workspace?: string };
  assistant?: { id: string; conversation_overrides?: Record<string, unknown> };
};

const create = vi.fn(async (_body: CreateBody) => ({ id: 'conversation-1' }));
const listAssistants = vi.fn(async () => [{ id: 'a1', name: 'The Fool', enabled: true, agent: { type: 'foolrs' } }]);
const listProviders = vi.fn(async () => [
  { id: 'p1', platform: 'openai-compatible', name: 'local', base_url: '', api_key: '', models: ['gemma-4-e4b'] },
]);
const listServers = vi.fn(async () => [{ id: 'mcp-1', enabled: true }]);

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { create: { invoke: create } },
    assistants: { list: { invoke: listAssistants } },
    mode: { listProviders: { invoke: listProviders } },
    mcpService: { listServers: { invoke: listServers } },
  },
}));

const { openSpokenSession } = await import('@renderer/services/voice/session/spokenSession');

/** Voice settings with an agent and a model actually pinned, as a used app has. */
const pinned = {
  ...DEFAULT_FOOL_VOICE_SETTINGS,
  session: { ...DEFAULT_FOOL_VOICE_SETTINGS.session, assistantId: 'a1', providerId: 'p1', modelId: 'gemma-4-e4b' },
};

const input = (settings = pinned) => ({
  settings,
  interfaceLanguage: 'tr-TR',
  voices: [],
  sessionRules: [] as readonly string[],
});

const bodyOf = (): CreateBody => create.mock.calls[0]?.[0] as CreateBody;

describe('openSpokenSession', () => {
  beforeEach(() => {
    create.mockClear();
    create.mockResolvedValue({ id: 'conversation-1' });
    listAssistants.mockResolvedValue([{ id: 'a1', name: 'The Fool', enabled: true, agent: { type: 'foolrs' } }]);
  });

  it('carries the persona, the memory and the skills as the session prompt', async () => {
    const result = await openSpokenSession(input());

    expect(result).toEqual({ ok: true, conversationId: 'conversation-1' });
    // The whole point of the move: what the spoken conversation used to hold in
    // its own head now travels with the session the agent runtime owns.
    expect(bodyOf().extra?.system_prompt?.length ?? 0).toBeGreaterThan(0);
  });

  it('names the conversation so the list does not fill with untitled rows', async () => {
    await openSpokenSession(input());
    expect(bodyOf().name).toBeTruthy();
  });

  it('hands the enabled MCP servers to the session', async () => {
    await openSpokenSession(input());
    expect(bodyOf().assistant?.conversation_overrides).toEqual(expect.objectContaining({ mcp_ids: ['mcp-1'] }));
  });

  it('reports no-agent rather than throwing when there is nothing to talk to', async () => {
    listAssistants.mockResolvedValueOnce([]);
    const result = await openSpokenSession(input({ ...pinned, session: { ...pinned.session, assistantId: '' } }));
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'no-agent' }));
  });

  it('refuses rather than guessing when the embedded agent has no model pinned', async () => {
    // The embedded backend is handed the provider record itself. Opening a
    // session without one would answer on whatever the agent was last left on,
    // which is exactly what pinning exists to prevent.
    const result = await openSpokenSession(input(DEFAULT_FOOL_VOICE_SETTINGS));
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'agent-unavailable' }));
  });

  it('reports create-failed rather than throwing when the backend refuses', async () => {
    create.mockRejectedValueOnce(new Error('backend is down'));
    const result = await openSpokenSession(input());
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'create-failed' }));
  });
});
