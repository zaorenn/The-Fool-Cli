/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings } from '@/common/types/foolVoice';

/**
 * A spoken instruction becoming work that actually happens.
 *
 * What this replaced pre-filled the home page's chat box and never pressed send,
 * so "open Discord and message my friend" produced an assistant that said it was
 * on it and a text box the user had to find and submit themselves. Worse, the
 * navigation to that page unmounted the voice conversation, which closed the
 * microphone — asking for something ended the conversation you asked in.
 *
 * So the two things worth pinning here are that a message is really sent, and
 * that nothing navigates.
 */

type Listener<T> = (event: T) => void;

const assistantsList = vi.fn();
const listProviders = vi.fn();
const conversationCreate = vi.fn();
const ensureRuntime = vi.fn();
const sendMessage = vi.fn();

/** Subscribers, so a test can push events the way the backend would. */
const streamListeners: Listener<Record<string, unknown>>[] = [];
const turnListeners: Listener<Record<string, unknown>>[] = [];

vi.mock('@/common', () => ({
  ipcBridge: {
    assistants: { list: { invoke: () => assistantsList() } },
    mode: { listProviders: { invoke: () => listProviders() } },
    conversation: {
      create: { invoke: (request: unknown) => conversationCreate(request) },
      ensureRuntime: { invoke: (request: unknown) => ensureRuntime(request) },
      sendMessage: { invoke: (request: unknown) => sendMessage(request) },
      responseStream: {
        on: (listener: Listener<Record<string, unknown>>) => {
          streamListeners.push(listener);
          return () => streamListeners.splice(streamListeners.indexOf(listener), 1);
        },
      },
      turnCompleted: {
        on: (listener: Listener<Record<string, unknown>>) => {
          turnListeners.push(listener);
          return () => turnListeners.splice(turnListeners.indexOf(listener), 1);
        },
      },
    },
  },
}));

const { runAgentTask } = await import('@renderer/services/voice/session/runAgentTask');

const ASSISTANT = { id: 'fool-assistant', name: 'Jester', enabled: true };

const settingsWith = (change: Partial<FoolVoiceSettings['session']> = {}): FoolVoiceSettings => ({
  ...structuredClone(DEFAULT_FOOL_VOICE_SETTINGS),
  session: {
    ...DEFAULT_FOOL_VOICE_SETTINGS.session,
    assistantId: 'fool-assistant',
    providerId: 'lmstudio',
    modelId: 'qwen/qwen3-14b',
    ...change,
  },
});

/**
 * Pushes what the backend would while the agent works.
 *
 * Over a copy of the subscriber list, because a listener that settles the run
 * unsubscribes itself mid-iteration.
 */
const stream = (...events: Record<string, unknown>[]): void => {
  for (const event of events) {
    const listeners = streamListeners.slice();
    for (const listener of listeners) listener(event);
  }
};

/** The same, for the turn-completed channel. */
const completeTurn = (event: Record<string, unknown>): void => {
  const listeners = turnListeners.slice();
  for (const listener of listeners) listener(event);
};

/** Lets the promise chain inside the runner settle. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
};

beforeEach(() => {
  assistantsList.mockReset().mockResolvedValue([ASSISTANT]);
  listProviders.mockReset().mockResolvedValue([{ id: 'lmstudio', platform: 'openai', models: ['qwen/qwen3-14b'] }]);
  conversationCreate.mockReset().mockResolvedValue({ id: 'conv-1' });
  ensureRuntime.mockReset().mockResolvedValue(undefined);
  sendMessage.mockReset().mockResolvedValue({ msg_id: 'm1', turn_id: 't1' });
  streamListeners.length = 0;
  turnListeners.length = 0;
  vi.stubGlobal('window', { setTimeout: setTimeout.bind(globalThis), clearTimeout: clearTimeout.bind(globalThis) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runAgentTask', () => {
  it('sends the task and answers with what the agent wrote', async () => {
    const progress: string[] = [];
    const running = runAgentTask({
      request: 'Discord’u aç ve arkadaşıma yaz.',
      settings: settingsWith(),
      onProgress: (detail) => progress.push(detail),
    });
    await settle();

    // The message is really sent — this is the whole difference from pre-filling
    // a box and leaving it there.
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversation_id: 'conv-1', input: 'Discord’u aç ve arkadaşıma yaz.' })
    );

    stream(
      { conversation_id: 'conv-1', type: 'tool_call', data: 'opening Discord' },
      { conversation_id: 'conv-1', type: 'content', data: 'Mesajı gönderdim.' },
      { conversation_id: 'conv-1', type: 'finish', data: '' }
    );

    await expect(running).resolves.toEqual({ ok: true, conversationId: 'conv-1', summary: 'Mesajı gönderdim.' });
    expect(progress).toContain('opening Discord');
  });

  it('opens the chat on the agent and model pinned for voice', async () => {
    const running = runAgentTask({ request: 'Bir şey yap.', settings: settingsWith() });
    await settle();
    stream({ conversation_id: 'conv-1', type: 'finish', data: '' });
    await running;

    expect(conversationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        assistant: expect.objectContaining({
          id: 'fool-assistant',
          conversation_overrides: { model: 'qwen/qwen3-14b' },
        }),
      })
    );
  });

  /**
   * The backend broadcasts the stored row's content parsed as JSON, so the text
   * arrives wrapped rather than bare — `{ content: … }` on a `text` row, a list
   * of parts on others. Reading only the bare form is how a task that really ran
   * comes back with an empty answer to read out.
   */
  it('reads the answer out of the shape the backend actually sends', async () => {
    const running = runAgentTask({ request: 'Bir şey yap.', settings: settingsWith() });
    await settle();

    stream(
      { conversation_id: 'conv-1', type: 'text', data: { content: 'Discord açıldı.' }, position: 'left' },
      { conversation_id: 'conv-1', type: 'text', data: [{ text: 'Mesaj gönderildi.' }], position: 'left' },
      { conversation_id: 'conv-1', type: 'finish', data: '' }
    );

    await expect(running).resolves.toMatchObject({ ok: true, summary: 'Discord açıldı. Mesaj gönderildi.' });
  });

  it('does not read the request back as if it were the answer', async () => {
    const running = runAgentTask({ request: 'Discord’u aç.', settings: settingsWith() });
    await settle();

    stream(
      // The user's own message comes down the same channel, on the right.
      { conversation_id: 'conv-1', type: 'text', data: { content: 'Discord’u aç.' }, position: 'right' },
      { conversation_id: 'conv-1', type: 'text', data: { content: 'Açtım.' }, position: 'left' },
      { conversation_id: 'conv-1', type: 'finish', data: '' }
    );

    await expect(running).resolves.toMatchObject({ ok: true, summary: 'Açtım.' });
  });

  it('ignores another conversation’s events', async () => {
    const running = runAgentTask({ request: 'Bir şey yap.', settings: settingsWith() });
    await settle();

    stream({ conversation_id: 'someone-else', type: 'content', data: 'not ours' });
    stream({ conversation_id: 'someone-else', type: 'finish', data: '' });
    stream({ conversation_id: 'conv-1', type: 'content', data: 'ours' });
    stream({ conversation_id: 'conv-1', type: 'finish', data: '' });

    await expect(running).resolves.toMatchObject({ ok: true, summary: 'ours' });
  });

  it('finishes on the turn event when the stream never says it is done', async () => {
    const running = runAgentTask({ request: 'Bir şey yap.', settings: settingsWith() });
    await settle();

    stream({ conversation_id: 'conv-1', type: 'content', data: 'Bitti.' });
    completeTurn({ session_id: 'conv-1', status: 'finished', state: 'stopped', last_message: { content: 'Bitti.' } });

    await expect(running).resolves.toMatchObject({ ok: true, summary: 'Bitti.' });
  });

  it('reports a run that stopped on an error', async () => {
    const running = runAgentTask({ request: 'Bir şey yap.', settings: settingsWith() });
    await settle();

    completeTurn({ session_id: 'conv-1', status: 'finished', state: 'error', detail: 'agent crashed' });

    await expect(running).resolves.toEqual({ ok: false, reason: 'run-failed', detail: 'agent crashed' });
  });

  it('says which piece is missing rather than failing anonymously', async () => {
    // Nothing pinned is the picker's default and now means the first enabled
    // agent — "no-agent" is kept for there being no agent at all.
    assistantsList.mockResolvedValue([]);
    await expect(runAgentTask({ request: 'x', settings: settingsWith({ assistantId: '' }) })).resolves.toMatchObject({
      ok: false,
      reason: 'no-agent',
    });

    assistantsList.mockResolvedValue([]);
    await expect(runAgentTask({ request: 'x', settings: settingsWith() })).resolves.toMatchObject({
      ok: false,
      reason: 'agent-unavailable',
    });

    assistantsList.mockResolvedValue([ASSISTANT]);
    conversationCreate.mockResolvedValue(null);
    await expect(runAgentTask({ request: 'x', settings: settingsWith() })).resolves.toMatchObject({
      ok: false,
      reason: 'create-failed',
    });
  });

  it('stops listening when the conversation that asked has gone', async () => {
    const controller = new AbortController();
    const running = runAgentTask({ request: 'x', settings: settingsWith(), signal: controller.signal });
    await settle();

    controller.abort();
    await expect(running).resolves.toEqual({ ok: false, reason: 'cancelled' });
    // Nothing is left subscribed: an abandoned task must not keep a listener for
    // the rest of the session.
    expect(streamListeners).toHaveLength(0);
    expect(turnListeners).toHaveLength(0);
  });

  it('carries on when the backend has no runtime to ensure', async () => {
    ensureRuntime.mockRejectedValue(new Error('no such route'));
    const running = runAgentTask({ request: 'x', settings: settingsWith() });
    await settle();

    expect(sendMessage).toHaveBeenCalled();
    stream({ conversation_id: 'conv-1', type: 'finish', data: '' });
    await expect(running).resolves.toMatchObject({ ok: true });
  });
});
