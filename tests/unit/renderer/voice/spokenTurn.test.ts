/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  // Snapshot: a listener may unsubscribe itself while the message is delivered.
  const listeners = [...streamListeners];
  for (const listener of listeners) listener({ conversation_id: 'c1', position: 'left', ...message });
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

  it('hands back everything it said, and how much work was behind it', async () => {
    const turn = runSpokenTurn({ conversationId: 'c1', said: 'hello', onSentence: () => undefined });
    await settle();
    emit({ type: 'content', data: 'All done.' });
    emit({ type: 'finish' });

    // The count comes back because only this function sees it, and the caller
    // needs it to know what a turn that said nothing owes: a confirmation for
    // work that went unmentioned, an admission for a turn that did nothing.
    await expect(turn).resolves.toEqual({ ok: true, spoken: 'All done.', toolsRan: 0 });
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

    const listeners = [...streamListeners];
    for (const listener of listeners) {
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

    const [[sent]] = sendMessage.mock.calls as [{ input: string }][];
    expect(sent.input).toBe('hello');
  });
});

describe('runSpokenTurn and the claim gate', () => {
  beforeEach(() => {
    streamListeners.length = 0;
    completedListeners.length = 0;
    sendMessage.mockClear();
    sendMessage.mockResolvedValue({ msg_id: 'm1', turn_id: 'turn-9', runtime: {} });
  });

  it('never speaks a claim that no tool backs', async () => {
    const spoken: string[] = [];
    const refused: string[] = [];
    const turn = runSpokenTurn({
      conversationId: 'c1',
      said: 'favori şarkımı aç',
      onSentence: (s) => spoken.push(s),
      onRefused: (c) => refused.push(c),
    });
    await settle();

    emit({ type: 'content', data: 'Şimdi çalıyor.' });
    emit({ type: 'finish' });
    await turn;

    expect(spoken).toEqual([]);
    expect(refused).toHaveLength(1);
  });

  it('speaks a claim of work done once a tool has come back', async () => {
    const spoken: string[] = [];
    const turn = runSpokenTurn({ conversationId: 'c1', said: 'mesajı gönder', onSentence: (s) => spoken.push(s) });
    await settle();

    // A step on the stream is the agent doing something, which is what makes
    // the claim true rather than a lie.
    emit({ type: 'tool_call', data: { name: 'app_skill_do' } });
    emit({ type: 'content', data: 'Mesajı gönderdim.' });
    emit({ type: 'finish' });
    await turn;

    expect(spoken).toEqual(['Mesajı gönderdim.']);
  });

  /**
   * A claim about sound is not licensed by a tool having run, and on this
   * surface it cannot be licensed at all.
   *
   * `app_skill_do` ends with an address in a browser, which is a page opening
   * rather than a song starting — the exact substitution the observed
   * transcript made. So the count that satisfies every other gate has to leave
   * this one unsatisfied.
   */
  it('never speaks a claim that something is playing on a tool count alone', async () => {
    const spoken: string[] = [];
    const refused: string[] = [];
    const turn = runSpokenTurn({
      conversationId: 'c1',
      said: 'favori şarkımı aç',
      onSentence: (s) => spoken.push(s),
      onRefused: (c) => refused.push(c),
    });
    await settle();

    emit({ type: 'tool_call', data: { name: 'app_skill_do' } });
    emit({ type: 'content', data: 'Şimdi çalıyor.' });
    emit({ type: 'finish' });
    await turn;

    expect(spoken).toEqual([]);
    expect(refused).toHaveLength(1);
  });

  /**
   * Not even `app_play` running is enough here, and that asymmetry is
   * deliberate. This stream carries the *name* of what ran and never what it
   * answered — and `app_play` answers just as successfully having opened a page
   * as having started a song. Only the loop that reads the result may say so,
   * through `startedPlayback`.
   */
  it('does not treat the player having run as evidence that it played', async () => {
    const spoken: string[] = [];
    const turn = runSpokenTurn({ conversationId: 'c1', said: 'favori şarkımı aç', onSentence: (s) => spoken.push(s) });
    await settle();

    emit({ type: 'tool_call', data: { name: 'app_play' } });
    emit({ type: 'content', data: 'Şimdi çalıyor.' });
    emit({ type: 'finish' });
    await turn;

    expect(spoken).toEqual([]);
  });

  it('speaks it when whoever read the result says a player started', async () => {
    const spoken: string[] = [];
    const turn = runSpokenTurn({
      conversationId: 'c1',
      said: 'favori şarkımı aç',
      onSentence: (s) => spoken.push(s),
      startedPlayback: () => true,
    });
    await settle();

    emit({ type: 'tool_call', data: { name: 'app_play' } });
    emit({ type: 'content', data: 'Şimdi çalıyor.' });
    emit({ type: 'finish' });
    await turn;

    expect(spoken).toEqual(['Şimdi çalıyor.']);
  });
});

describe('a turn where the gate refuses everything', () => {
  beforeEach(() => {
    streamListeners.length = 0;
    completedListeners.length = 0;
    sendMessage.mockClear();
    sendMessage.mockResolvedValue({ msg_id: 'm1', turn_id: 'turn-9', runtime: {} });
  });

  it('speaks nothing and reports the refusal, so the caller can say something true', async () => {
    // Reported from a real conversation: ask for something the model cannot do,
    // it claims it did, the gate refuses it, and the user hears **silence** —
    // which is indistinguishable from a crash and is the one outcome this
    // application must never produce. The turn's job is to report the refusal;
    // saying the true thing instead is the caller's, and `localPipeline` does it.
    const spoken: string[] = [];
    const refusals: string[] = [];

    const turn = runSpokenTurn({
      conversationId: 'c1',
      said: 'Bana Tokyo’ya uçak bileti al.',
      onSentence: (sentence) => spoken.push(sentence),
      onRefused: (correction) => refusals.push(correction),
      remembered: 0,
    });
    await settle();

    // A completed-action claim with no tool behind it.
    emit({ type: 'content', data: 'Tamam, bileti aldım.' });
    emit({ type: 'finish' });
    await turn;

    expect(spoken).toEqual([]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('bileti aldım');
  });
});

/**
 * The third thing the gate refuses, and the only one whose evidence outlives
 * the turn.
 */
describe('runSpokenTurn and a screen it has not seen', () => {
  beforeEach(() => {
    streamListeners.length = 0;
    completedListeners.length = 0;
    sendMessage.mockClear();
    sendMessage.mockResolvedValue({ msg_id: 'm1', turn_id: 'turn-9', runtime: {} });
  });

  it('refuses a description of a screen nothing has looked at', async () => {
    const spoken: string[] = [];
    const refused: string[] = [];
    const turn = runSpokenTurn({
      conversationId: 'c1',
      said: 'şu hata ne diyor',
      onSentence: (s) => spoken.push(s),
      onRefused: (c) => refused.push(c),
      lookedAtScreen: () => false,
    });
    await settle();

    emit({ type: 'content', data: 'Ekranında bir bağlantı hatası var.' });
    emit({ type: 'finish' });
    await turn;

    expect(spoken).toEqual([]);
    expect(refused[0]).toContain('app_look_at_screen');
  });

  /// The reason the evidence is a function and not a value. The model asks to
  /// look, the look comes back mid-turn, and the sentence after it is the
  /// correct answer to the question the gate itself forced.
  it('speaks the description once the look has come back in the same turn', async () => {
    const spoken: string[] = [];
    let seen = false;
    const turn = runSpokenTurn({
      conversationId: 'c1',
      said: 'şu hata ne diyor',
      onSentence: (s) => spoken.push(s),
      lookedAtScreen: () => seen,
      onLookedAtScreen: () => (seen = true),
    });
    await settle();

    emit({ type: 'tool_call', data: { name: 'app_look_at_screen' } });
    emit({ type: 'content', data: 'Ekranında bir bağlantı hatası var.' });
    emit({ type: 'finish' });
    await turn;

    expect(seen).toBe(true);
    expect(spoken).toEqual(['Ekranında bir bağlantı hatası var.']);
  });

  it('does not take any other tool as having looked', async () => {
    const spoken: string[] = [];
    let seen = false;
    const turn = runSpokenTurn({
      conversationId: 'c1',
      said: 'şu hata ne diyor',
      onSentence: (s) => spoken.push(s),
      lookedAtScreen: () => seen,
      onLookedAtScreen: () => (seen = true),
    });
    await settle();

    emit({ type: 'tool_call', data: { name: 'app_search' } });
    emit({ type: 'content', data: 'Ekranında bir bağlantı hatası var.' });
    emit({ type: 'finish' });
    await turn;

    expect(seen).toBe(false);
    expect(spoken).toEqual([]);
  });
});

/**
 * Where a filler goes, and when it is worth saying at all.
 *
 * Both halves were reported from the app at once: the fillers were printed in
 * the answer box as though they were the answer — "Bir saniye.Hmm, düşüneyim.Az
 * kaldı." — and they seemed to delay the reply rather than cover the wait for
 * it. One cause each, and the second is the one that matters, because a filler
 * that makes the answer later is worse than no filler.
 */
describe('runSpokenTurn and filling a silence', () => {
  beforeEach(() => {
    streamListeners.length = 0;
    completedListeners.length = 0;
    sendMessage.mockClear();
    sendMessage.mockResolvedValue({ msg_id: 'm1', turn_id: 'turn-9', runtime: {} });
    vi.useFakeTimers();
  });

  // Restored explicitly: fake timers outlive the block that installed them, and
  // a suite that leaks them fails somewhere else entirely.
  afterEach(() => {
    vi.useRealTimers();
  });

  it('speaks a filler without writing it into the answer', async () => {
    const spoken: string[] = [];
    const fillers: string[] = [];
    const turn = runSpokenTurn({
      conversationId: 'c1',
      said: 'klasörü topla',
      onSentence: (s) => spoken.push(s),
      onFiller: (line) => fillers.push(line),
      fillerLine: () => 'Bir saniye.',
    });
    await vi.advanceTimersByTimeAsync(0);

    // A tool came back, so there is genuinely something to be waiting for.
    emit({ type: 'tool_call', data: { name: 'app_ask_jester' } });
    await vi.advanceTimersByTimeAsync(3_000);

    expect(fillers).toContain('Bir saniye.');
    // The whole point: nothing a person said, so nothing in the transcript.
    expect(spoken).toEqual([]);

    emit({ type: 'finish' });
    await turn;
  });

  /// The queue is spoken in order, so a filler that wins the race by a moment
  /// puts a whole synthesised clip in front of the first real sentence.
  it('says nothing while the speaker still has the answer to get through', async () => {
    const fillers: string[] = [];
    const turn = runSpokenTurn({
      conversationId: 'c1',
      said: 'klasörü topla',
      onSentence: () => undefined,
      onFiller: (line) => fillers.push(line),
      fillerLine: () => 'Bir saniye.',
      speakerBusy: () => true,
    });
    await vi.advanceTimersByTimeAsync(0);

    emit({ type: 'tool_call', data: { name: 'app_ask_jester' } });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fillers).toEqual([]);

    emit({ type: 'finish' });
    await turn;
  });

  // There is deliberately no test for "a caller that passes `fillerLine` and no
  // `onFiller`". Written, it asserts that nothing is spoken — and nothing is
  // spoken if the filler timer is deleted outright, so it would pass against
  // the absence of the whole feature. A test whose target can be removed
  // without failing it is not protecting anything.
});
