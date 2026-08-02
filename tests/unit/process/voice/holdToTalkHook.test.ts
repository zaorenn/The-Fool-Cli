/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { HoldToTalkHook, RIGHT_CTRL_KEYCODE, type UiohookLike } from '@process/voice/holdToTalkHook';
import type { HoldToTalkEffect } from '@process/voice/holdToTalk';

/** A hook whose events the test pushes by hand. */
const fakeHook = () => {
  const listeners: Record<string, ((event: { keycode: number }) => void)[]> = { keydown: [], keyup: [] };
  const hook: UiohookLike & { started: boolean; stopped: boolean } = {
    started: false,
    stopped: false,
    on: (event, listener) => listeners[event].push(listener),
    off: (event, listener) => {
      listeners[event] = listeners[event].filter((entry) => entry !== listener);
    },
    start: () => {
      hook.started = true;
    },
    stop: () => {
      hook.stopped = true;
    },
  };
  return {
    hook,
    down: (keycode: number) => listeners.keydown.forEach((listener) => listener({ keycode })),
    up: (keycode: number) => listeners.keyup.forEach((listener) => listener({ keycode })),
  };
};

const setup = (options: { minimumHoldMs?: number } = {}) => {
  const effects: HoldToTalkEffect[] = [];
  const { hook, down, up } = fakeHook();
  const subject = new HoldToTalkHook({
    onEffect: (effect) => effects.push(effect),
    hold: { minimumHoldMs: options.minimumHoldMs ?? 0 },
    loadHook: () => hook,
  });
  return { subject, effects, hook, down, up };
};

describe('HoldToTalkHook', () => {
  it('opens a turn on right Ctrl and speaks it on release', () => {
    const { subject, effects, down, up } = setup();
    expect(subject.start()).toBe(true);

    down(RIGHT_CTRL_KEYCODE);
    up(RIGHT_CTRL_KEYCODE);

    expect(effects.map((effect) => effect.kind)).toEqual(['start', 'commit']);
  });

  /**
   * The reason this key is safe to claim: the combination still belongs to
   * whatever is underneath.
   */
  it('abandons the turn when another key joins the hold', () => {
    const { subject, effects, down, up } = setup();
    subject.start();

    down(RIGHT_CTRL_KEYCODE);
    down(46); // C
    up(RIGHT_CTRL_KEYCODE);

    expect(effects).toEqual([{ kind: 'start' }, { kind: 'cancel', reason: 'combination' }]);
  });

  it('ignores every other key while nothing is held', () => {
    const { subject, effects, down, up } = setup();
    subject.start();

    down(46);
    up(46);

    expect(effects).toEqual([]);
  });

  /**
   * A native module that will not load must cost hold-to-talk and nothing else.
   * Thrown from here it would take the whole main process down at startup.
   */
  it('reports a hook that cannot be loaded instead of throwing', () => {
    const logWarn = vi.fn();
    const subject = new HoldToTalkHook({
      onEffect: vi.fn(),
      loadHook: () => {
        throw new Error('not built for this ABI');
      },
      logWarn,
    });

    expect(subject.start()).toBe(false);
    expect(subject.isRunning).toBe(false);
    expect(logWarn).toHaveBeenCalled();
  });

  // A hold whose release can no longer arrive would leave the microphone open.
  it('closes an open hold when it stops listening', () => {
    const { subject, effects, hook, down } = setup();
    subject.start();

    down(RIGHT_CTRL_KEYCODE);
    subject.stop();

    expect(effects.map((effect) => effect.kind)).toEqual(['start', 'cancel']);
    expect(hook.stopped).toBe(true);
    expect(subject.isRunning).toBe(false);
  });

  it('starts the hook once however many times it is asked', () => {
    const { subject, hook } = setup();

    expect(subject.start()).toBe(true);
    expect(subject.start()).toBe(true);

    expect(hook.started).toBe(true);
    expect(subject.isRunning).toBe(true);
  });
});
