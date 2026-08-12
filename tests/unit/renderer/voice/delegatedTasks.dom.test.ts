/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DelegatedTasks } from '@renderer/pages/voice/runtime/delegatedTasks';
import { BETWEEN_ASIDES_MS, QUIET_BEFORE_ASIDE_MS } from '@/common/voice/thinkingAloud';

/**
 * What a delegated task owes the conversation once it finishes.
 *
 * The behaviour worth holding onto is not that it speaks — it is *when* it
 * refuses to. Over an answer, over the user, and over the previous completion
 * are three different ways of talking across somebody, and every one of them
 * was reachable before this existed.
 */

/** A stand-in `t` that renders the interpolation, so the line can be asserted. */
const t = (key: string, values?: Record<string, unknown>): string =>
  `${key}${
    values
      ? `|${Object.entries(values)
          .map(([name, value]) => `${name}=${String(value)}`)
          .join(',')}`
      : ''
  }`;

type Moment = {
  phase: string;
  standby: boolean;
  quietForMs: number;
  hushed?: boolean;
  enabled?: boolean;
  holdingToTalk?: boolean;
  userIsTyping?: boolean;
};

const setup = (moment: Moment) => {
  const spoken: string[] = [];
  const noted: string[] = [];
  const current = { ...moment };
  const tasks = new DelegatedTasks({
    t,
    moment: () => current,
    speak: (line) => spoken.push(line),
    note: (line) => noted.push(line),
  });
  return { tasks, spoken, noted, current };
};

/** Lets the `.then` on a resolved promise run before the timers are advanced. */
const settle = (): Promise<void> => vi.advanceTimersByTimeAsync(0).then(() => undefined);

describe('DelegatedTasks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * The conversation was already answering these three and this class dropped
   * them, because `tick` named the fields it read. A completion was therefore
   * announced to somebody who had said "be quiet", or who had switched
   * unprompted speech off entirely — the switch reached for instead of
   * uninstalling.
   */
  it.each([
    ['a hush', { hushed: true }],
    ['the off switch', { enabled: false }],
    ['the talk key being held', { holdingToTalk: true }],
    ['the user typing', { userIsTyping: true }],
  ])('holds a finished task for %s', async (_name, refusing) => {
    const { tasks, spoken, current } = setup({
      phase: 'listening',
      standby: false,
      quietForMs: 60_000,
      ...refusing,
    });

    tasks.follow('book a flight', Promise.resolve({ ok: true, detail: 'Booked.' }));
    await settle();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(spoken).toEqual([]);

    // And says it once the reason goes away, so this is a wait and not a loss.
    Object.assign(current, { hushed: false, enabled: true, holdingToTalk: false, userIsTyping: false });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(spoken).toHaveLength(1);
  });

  it('says nothing until the task finishes', async () => {
    const { tasks, spoken } = setup({ phase: 'listening', standby: false, quietForMs: 60_000 });
    let finish: (outcome: { ok: boolean; detail: string }) => void = () => undefined;
    tasks.follow('book a flight', new Promise((resolve) => (finish = resolve)));

    await vi.advanceTimersByTimeAsync(30_000);
    expect(spoken).toEqual([]);
    expect(tasks.outstanding).toBe(1);

    finish({ ok: true, detail: 'Booked.' });
    await settle();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(spoken).toHaveLength(1);
    expect(tasks.outstanding).toBe(0);
  });

  it('volunteers the finish into a gap', async () => {
    const { tasks, spoken, noted } = setup({ phase: 'listening', standby: false, quietForMs: 60_000 });
    tasks.follow('back up the photos', Promise.resolve({ ok: true, detail: 'Copied 412 files.' }));

    await settle();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(spoken).toEqual(['settings.voice.thinkingAloud.aside.0|what=back up the photos']);
    // The user will ask what it said, and the answer has to already be there.
    expect(noted[0]).toContain('Copied 412 files.');
  });

  it('waits rather than talking over an answer', async () => {
    const { tasks, spoken, current } = setup({ phase: 'speaking', standby: false, quietForMs: 0 });
    tasks.follow('back up the photos', Promise.resolve({ ok: true, detail: 'done' }));

    await settle();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(spoken).toEqual([]);

    current.phase = 'listening';
    current.quietForMs = QUIET_BEFORE_ASIDE_MS;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(spoken).toHaveLength(1);
  });

  it('waits rather than talking over the user', async () => {
    const { tasks, spoken, current } = setup({ phase: 'hearing', standby: false, quietForMs: 0 });
    tasks.follow('back up the photos', Promise.resolve({ ok: true, detail: 'done' }));

    await settle();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(spoken).toEqual([]);

    current.phase = 'listening';
    current.quietForMs = QUIET_BEFORE_ASIDE_MS;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(spoken).toHaveLength(1);
  });

  it('stays quiet while it has been told to wait', async () => {
    const { tasks, spoken } = setup({ phase: 'listening', standby: true, quietForMs: 60_000 });
    tasks.follow('back up the photos', Promise.resolve({ ok: true, detail: 'done' }));

    await settle();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(spoken).toEqual([]);
  });

  it('leaves a gap between two completions rather than running them together', async () => {
    const { tasks, spoken } = setup({ phase: 'listening', standby: false, quietForMs: 60_000 });
    tasks.follow('first job', Promise.resolve({ ok: true, detail: 'a' }));
    tasks.follow('second job', Promise.resolve({ ok: true, detail: 'b' }));

    await settle();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(spoken).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(BETWEEN_ASIDES_MS);
    expect(spoken).toHaveLength(2);
    // A different line each time: the same sentence twice is what a machine
    // sounds like.
    expect(spoken[0]).not.toBe(spoken[1]);
  });

  it('does not report a failed task as finished', async () => {
    const { tasks, spoken, noted } = setup({ phase: 'listening', standby: false, quietForMs: 60_000 });
    tasks.follow('buy a ticket to Tokyo', Promise.resolve({ ok: false, detail: 'no agent is connected' }));

    await settle();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(spoken[0]).toContain('settings.voice.conversationAsideFailed');
    expect(spoken[0]).toContain('why=no agent is connected');
    expect(noted[0]).toContain('could not be finished');
  });

  it('treats a thrown task as a failed one rather than losing it', async () => {
    const { tasks, spoken } = setup({ phase: 'listening', standby: false, quietForMs: 60_000 });
    tasks.follow('something', Promise.reject(new Error('the bridge went away')));

    await settle();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(spoken[0]).toContain('why=the bridge went away');
  });

  it('says nothing once the conversation has ended', async () => {
    const { tasks, spoken } = setup({ phase: 'listening', standby: false, quietForMs: 60_000 });
    tasks.follow('back up the photos', Promise.resolve({ ok: true, detail: 'done' }));
    tasks.close();

    await settle();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(spoken).toEqual([]);
  });
});
