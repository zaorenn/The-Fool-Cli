/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type StreamMessage = Record<string, unknown>;

const streamListeners: ((message: StreamMessage) => void)[] = [];
const completedListeners: ((event: StreamMessage) => void)[] = [];

const sendMessage = vi.fn(async () => ({ msg_id: 'm1', turn_id: 'turn-9', runtime: {} }));
const ensureRuntime = vi.fn(async () => undefined);
const stop = vi.fn(async () => ({ runtime: {} }));

const subscribe =
  (into: ((message: StreamMessage) => void)[]) =>
  (callback: (message: StreamMessage) => void): (() => void) => {
    into.push(callback);
    return () => {
      const index = into.indexOf(callback);
      if (index >= 0) into.splice(index, 1);
    };
  };

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      sendMessage: { invoke: sendMessage },
      ensureRuntime: { invoke: ensureRuntime },
      stop: { invoke: stop },
      responseStream: { on: subscribe(streamListeners) },
      turnCompleted: { on: subscribe(completedListeners) },
    },
  },
}));

const { runSpokenTurn } = await import('@renderer/services/voice/session/spokenTurn');

/** One streamed message, as the backend broadcasts it. */
const emit = (message: StreamMessage): void => {
  for (const listener of [...streamListeners]) listener({ conversation_id: 'c1', position: 'left', ...message });
};

/** Lets the turn's own listeners run before the test looks at the result. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('runSpokenTurn', () => {
  beforeEach(() => {
    streamListeners.length = 0;
    completedListeners.length = 0;
    sendMessage.mockClear();
    sendMessage.mockResolvedValue({ msg_id: 'm1', turn_id: 'turn-9', runtime: {} });
    stop.mockClear();
  });

  it('speaks each sentence as it arrives rather than at the end', async () => {
    const spoken: string[] = [];
    const turn = runSpokenTurn({ conversationId: 'c1', said: 'hello', onSentence: (s) => spoken.push(s) });
    await settle();

    emit({ type: 'content', data: 'Good ' });
    emit({ type: 'content', data: 'morning. ' });
    // The reply is spoken while the rest is still being written; waiting for the
    // whole answer is the difference between a conversation and a form.
    expect(spoken).toEqual(['Good morning.']);

    emit({ type: 'content', data: 'It is raining.' });
    emit({ type: 'finish' });
    await turn;

    expect(spoken).toEqual(['Good morning.', 'It is raining.']);
  });

  it('hands back everything it said', async () => {
    const turn = runSpokenTurn({ conversationId: 'c1', said: 'hello', onSentence: () => undefined });
    await settle();
    emit({ type: 'content', data: 'All done.' });
    emit({ type: 'finish' });

    await expect(turn).resolves.toEqual({ ok: true, spoken: 'All done.' });
  });

  it('reports a run error rather than resolving silently', async () => {
    const turn = runSpokenTurn({ conversationId: 'c1', said: 'hello', onSentence: () => undefined });
    await settle();
    emit({ status: 'error', data: 'the model went away' });

    await expect(turn).resolves.toEqual(expect.objectContaining({ ok: false, reason: 'run-failed' }));
  });

  it('ignores the request coming back on the same channel', async () => {
    const spoken: string[] = [];
    const turn = runSpokenTurn({ conversationId: 'c1', said: 'hello', onSentence: (s) => spoken.push(s) });
    await settle();

    for (const listener of [...streamListeners]) {
      listener({ conversation_id: 'c1', position: 'right', type: 'content', data: 'hello.' });
    }
    emit({ type: 'finish' });
    await turn;

    expect(spoken).toEqual([]);
  });

  it('stops the model, not just the speaker', async () => {
    const controller = new AbortController();
    const turn = runSpokenTurn({
      conversationId: 'c1',
      said: 'hello',
      onSentence: () => undefined,
      signal: controller.signal,
    });
    await settle();
    controller.abort();

    await expect(turn).resolves.toEqual(expect.objectContaining({ ok: false, reason: 'cancelled' }));
    await settle();
    expect(stop).toHaveBeenCalledWith({ conversation_id: 'c1', turn_id: 'turn-9' });
  });

  it('does not call stop when there is no turn to stop', async () => {
    // Cancelling before the send has been accepted would post a stop for an
    // empty id, and the route answers that with an error the user hears as a
    // failure for something they never asked to fail.
    sendMessage.mockResolvedValueOnce({ msg_id: 'm1', turn_id: '', runtime: {} });
    const controller = new AbortController();
    const turn = runSpokenTurn({
      conversationId: 'c1',
      said: 'hello',
      onSentence: () => undefined,
      signal: controller.signal,
    });
    await settle();
    controller.abort();

    await turn;
    await settle();
    expect(stop).not.toHaveBeenCalled();
  });
});

describe('runSpokenTurn and instructions set out loud', () => {
  beforeEach(() => {
    streamListeners.length = 0;
    completedListeners.length = 0;
    sendMessage.mockClear();
    sendMessage.mockResolvedValue({ msg_id: 'm1', turn_id: 'turn-9', runtime: {} });
  });

  it('puts a rule set mid-conversation ahead of what was said', async () => {
    const turn = runSpokenTurn({
      conversationId: 'c1',
      said: 'what is the weather',
      onSentence: () => undefined,
      instructions: ['Answer in English.'],
    });
    await settle();
    emit({ type: 'finish' });
    await turn;

    const sent = sendMessage.mock.calls[0]?.[0] as { input: string };
    expect(sent.input.indexOf('Answer in English.')).toBeLessThan(sent.input.indexOf('what is the weather'));
  });

  it('sends what was said unchanged when nothing is pending', async () => {
    const turn = runSpokenTurn({ conversationId: 'c1', said: 'hello', onSentence: () => undefined });
    await settle();
    emit({ type: 'finish' });
    await turn;

    expect((sendMessage.mock.calls[0]?.[0] as { input: string }).input).toBe('hello');
  });
});
