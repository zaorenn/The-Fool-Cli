/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings } from '@/common/types/foolVoice';

const listAssistants = vi.fn();
const listProviders = vi.fn();
const createConversation = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    assistants: { list: { invoke: () => listAssistants() } },
    mode: { listProviders: { invoke: () => listProviders() } },
    conversation: { create: { invoke: (params: unknown) => createConversation(params) } },
  },
}));

vi.mock('i18next', () => ({ default: { language: 'tr-TR' } }));

const { findPinnedAssistant, findPinnedModel, startVoiceConversation } =
  await import('@renderer/services/voice/session/startVoiceConversation');

const assistant = (overrides: Partial<Assistant> = {}): Assistant =>
  ({
    id: 'hermes',
    source: 'user',
    name: 'Hermes',
    name_i18n: {},
    description_i18n: {},
    enabled: true,
    sort_order: 0,
    agent_id: 'foolrs',
    agent: { type: 'foolrs', source: 'internal' },
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
    agent_status: 'online',
    team_selectable: true,
    deletable: true,
    ...overrides,
  }) as Assistant;

const provider = (overrides: Partial<IProvider> = {}): IProvider => ({
  id: 'lmstudio',
  platform: 'openai',
  name: 'LM Studio (Local)',
  base_url: 'http://127.0.0.1:1234/v1',
  api_key: 'sk-local',
  models: ['qwen/qwen3.5-9b'],
  ...overrides,
});

const settings = (session: Partial<FoolVoiceSettings['session']> = {}): FoolVoiceSettings => ({
  ...DEFAULT_FOOL_VOICE_SETTINGS,
  session: { ...DEFAULT_FOOL_VOICE_SETTINGS.session, ...session },
});

const pinned = settings({ assistantId: 'hermes', providerId: 'lmstudio', modelId: 'qwen/qwen3.5-9b' });

describe('startVoiceConversation', () => {
  beforeEach(() => {
    listAssistants.mockReset();
    listProviders.mockReset();
    createConversation.mockReset();
    sessionStorage.clear();
    listAssistants.mockResolvedValue([assistant()]);
    listProviders.mockResolvedValue([provider()]);
    createConversation.mockResolvedValue({ id: 'conv-1' });
  });

  it('opens the chat on the pinned agent and model', async () => {
    const result = await startVoiceConversation({ text: 'run the tests', settings: pinned });

    expect(result).toEqual({ ok: true, conversationId: 'conv-1' });
    const params = createConversation.mock.calls[0][0] as {
      model?: { id: string; use_model: string };
      assistant?: { id: string; locale?: string; conversation_overrides?: { model?: string } };
    };
    expect(params.assistant?.id).toBe('hermes');
    expect(params.model).toMatchObject({ id: 'lmstudio', use_model: 'qwen/qwen3.5-9b' });
    expect(params.assistant?.conversation_overrides?.model).toBe('qwen/qwen3.5-9b');
  });

  it('creates the chat in the language the app is in', async () => {
    await startVoiceConversation({ text: 'run the tests', settings: pinned });

    const params = createConversation.mock.calls[0][0] as { assistant?: { locale?: string } };
    expect(params.assistant?.locale).toBe('tr-TR');
  });

  it('leaves the spoken text where the conversation page looks for it', async () => {
    await startVoiceConversation({ text: 'run the tests', settings: pinned });

    // The same handover the home page uses, so nothing about sending is duplicated.
    const stored = sessionStorage.getItem('foolrs_initial_message_conv-1');
    expect(JSON.parse(String(stored))).toEqual({ input: 'run the tests' });
  });

  it('uses the ACP handover key for an ACP agent', async () => {
    listAssistants.mockResolvedValue([assistant({ agent: { type: 'claude-code', source: 'builtin' } })]);

    await startVoiceConversation({ text: 'run the tests', settings: pinned });

    expect(sessionStorage.getItem('acp_initial_message_conv-1')).not.toBeNull();
    expect(sessionStorage.getItem('foolrs_initial_message_conv-1')).toBeNull();
  });

  it('attaches files with the message', async () => {
    await startVoiceConversation({
      text: 'look at this',
      files: [{ kind: 'upload', path: '/tmp/shot.png' }],
      settings: pinned,
    });

    const params = createConversation.mock.calls[0][0] as { extra: { default_files?: string[] } };
    expect(params.extra.default_files).toEqual(['/tmp/shot.png']);
    const stored = JSON.parse(String(sessionStorage.getItem('foolrs_initial_message_conv-1'))) as {
      files?: unknown[];
    };
    expect(stored.files).toEqual([{ kind: 'upload', path: '/tmp/shot.png' }]);
  });

  it('stands aside when no agent is pinned, so the home page still opens the chat', async () => {
    const result = await startVoiceConversation({ text: 'hello', settings: settings() });

    expect(result).toEqual({ ok: false, reason: 'no-agent' });
    expect(createConversation).not.toHaveBeenCalled();
  });

  it('reports a pinned agent that no longer exists rather than guessing another', async () => {
    listAssistants.mockResolvedValue([assistant({ id: 'someone-else' })]);

    const result = await startVoiceConversation({ text: 'hello', settings: pinned });

    expect(result).toEqual({ ok: false, reason: 'agent-missing' });
  });

  it('refuses an Fool CLI agent with no model, which it cannot be created without', async () => {
    const result = await startVoiceConversation({
      text: 'hello',
      settings: settings({ assistantId: 'hermes' }),
    });

    expect(result).toEqual({ ok: false, reason: 'no-model' });
  });

  // Hermes names the LM Studio model `lmstudio:qwen/qwen3.5-9b`; the The Fool
  // provider calls the same weights `qwen/qwen3.5-9b`. A pin in the agent's own
  // namespace matches no provider, and dropping it left the agent on whatever
  // model it was last set to.
  it("passes an ACP agent's own model id through, though no provider carries it", async () => {
    listAssistants.mockResolvedValue([assistant({ agent: { type: 'hermes', source: 'builtin' } })]);

    const result = await startVoiceConversation({
      text: 'run the tests',
      settings: settings({ assistantId: 'hermes', modelId: 'lmstudio:qwen/qwen3.5-9b' }),
    });

    expect(result).toEqual({ ok: true, conversationId: 'conv-1' });
    const params = createConversation.mock.calls[0][0] as {
      assistant?: { conversation_overrides?: { model?: string } };
    };
    expect(params.assistant?.conversation_overrides?.model).toBe('lmstudio:qwen/qwen3.5-9b');
  });

  it('lets an ACP agent fall back to its own model', async () => {
    listAssistants.mockResolvedValue([assistant({ agent: { type: 'claude-code', source: 'builtin' } })]);

    const result = await startVoiceConversation({
      text: 'hello',
      settings: settings({ assistantId: 'hermes' }),
    });

    expect(result).toEqual({ ok: true, conversationId: 'conv-1' });
    const params = createConversation.mock.calls[0][0] as { model?: unknown };
    expect(params.model).toBeUndefined();
  });

  it('reports a failed create rather than throwing at the voice loop', async () => {
    createConversation.mockRejectedValue(new Error('backend down'));

    expect(await startVoiceConversation({ text: 'hello', settings: pinned })).toEqual({
      ok: false,
      reason: 'create-failed',
    });
  });

  it('reports a create that returned no conversation', async () => {
    createConversation.mockResolvedValue(null);

    expect(await startVoiceConversation({ text: 'hello', settings: pinned })).toEqual({
      ok: false,
      reason: 'create-failed',
    });
  });
});

describe('findPinnedAssistant', () => {
  it('matches a built-in assistant stored without its prefix', () => {
    const builtin = assistant({ id: 'builtin-hermes' });

    expect(findPinnedAssistant([builtin], 'hermes')?.id).toBe('builtin-hermes');
  });

  it('matches a built-in assistant stored with its prefix', () => {
    const builtin = assistant({ id: 'hermes' });

    expect(findPinnedAssistant([builtin], 'builtin-hermes')?.id).toBe('hermes');
  });

  it('finds nothing for an id that is not there', () => {
    expect(findPinnedAssistant([assistant()], 'nobody')).toBeUndefined();
  });
});

describe('findPinnedModel', () => {
  it('turns a pinned pair into the provider record a conversation needs', () => {
    const resolved = findPinnedModel([provider()], 'lmstudio', 'qwen/qwen3.5-9b');

    expect(resolved).toMatchObject({ id: 'lmstudio', use_model: 'qwen/qwen3.5-9b', api_key: 'sk-local' });
    // `models` is replaced by `use_model`; leaving both would let them disagree.
    expect(resolved).not.toHaveProperty('models');
  });

  it('finds the model by name when the provider id has drifted', () => {
    expect(findPinnedModel([provider()], 'a-provider-that-was-recreated', 'qwen/qwen3.5-9b')).toBeUndefined();
    expect(findPinnedModel([provider()], '', 'qwen/qwen3.5-9b')?.use_model).toBe('qwen/qwen3.5-9b');
  });

  it('returns nothing when no model was pinned', () => {
    expect(findPinnedModel([provider()], 'lmstudio', '')).toBeUndefined();
  });

  it('returns nothing when the pinned model has gone', () => {
    expect(findPinnedModel([provider({ models: ['something-else'] })], 'lmstudio', 'qwen/qwen3.5-9b')).toBeUndefined();
  });
});
