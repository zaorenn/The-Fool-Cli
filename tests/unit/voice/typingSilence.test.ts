/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Not speaking into a sentence somebody is typing.
 *
 * The silence contract has had a `userIsTyping` field since it was written and
 * every caller passed `false`, because nothing in a spoken conversation could
 * see a keyboard in another window. The keyboard hook could — it already reads
 * every keystroke for the combination rule — so these cover the two halves of
 * closing that gap: what the hook is allowed to report, and what the aside path
 * does with the answer.
 *
 * The aside half is the one that found a real defect. The conversation was
 * supplying the hush, the off switch and the talk key, and `DelegatedTasks`
 * named three fields when it read them, so all three were dropped: a finished
 * task was announced to somebody who had said "be quiet".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STILL_TYPING_FOR_MS,
  TYPING_REPORT_EVERY_MS,
  isStillTyping,
  mayMentionAside,
  type AsideMoment,
} from '@/common/voice/thinkingAloud';
import { HoldToTalkHook, RIGHT_CTRL_KEYCODE, type UiohookLike } from '@process/voice/holdToTalkHook';

describe('isStillTyping', () => {
  it('counts a keystroke a moment ago as mid-sentence', () => {
    expect(isStillTyping(0)).toBe(true);
    expect(isStillTyping(TYPING_REPORT_EVERY_MS)).toBe(true);
  });

  it('lets an ordinary gap between two words pass without ending the sentence', () => {
    expect(isStillTyping(TYPING_REPORT_EVERY_MS + 1)).toBe(true);
  });

  it('stops once nothing has been typed for the window', () => {
    expect(isStillTyping(STILL_TYPING_FOR_MS)).toBe(false);
    expect(isStillTyping(STILL_TYPING_FOR_MS * 10)).toBe(false);
  });

  it('answers no for a machine that has never reported a keystroke', () => {
    // What `Date.now() - (-Infinity)` is, which is what a machine without the
    // native hook computes forever.
    expect(isStillTyping(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('survives a clock that went backwards rather than claiming forever-typing', () => {
    expect(isStillTyping(-5_000)).toBe(false);
  });

  it('forgets sooner than it repeats, so continuous typing never reads as finished', () => {
    expect(STILL_TYPING_FOR_MS).toBeGreaterThan(TYPING_REPORT_EVERY_MS);
  });
});

/** A hook whose keyboard is a function the test calls. */
const fakeKeyboard = (): { hook: UiohookLike; press: (keycode: number) => void } => {
  let down: ((event: { keycode: number }) => void) | null = null;
  return {
    hook: {
      on: (event, listener) => {
        if (event === 'keydown') down = listener;
      },
      off: () => undefined,
      start: () => undefined,
      stop: () => undefined,
    },
    press: (keycode) => down?.({ keycode }),
  };
};

describe('what the keyboard hook reports', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  const start = (onTyping: () => void) => {
    const keyboard = fakeKeyboard();
    const hook = new HoldToTalkHook({ onEffect: () => undefined, onTyping, loadHook: () => keyboard.hook });
    hook.start();
    return keyboard;
  };

  it('says somebody is typing when a key is pressed', () => {
    const onTyping = vi.fn();
    start(onTyping).press(30);

    expect(onTyping).toHaveBeenCalledTimes(1);
  });

  it('says it once per interval rather than once per keystroke', () => {
    const onTyping = vi.fn();
    const keyboard = start(onTyping);

    for (let index = 0; index < 40; index += 1) keyboard.press(30);

    expect(onTyping).toHaveBeenCalledTimes(1);
  });

  it('says it again once the interval has passed, so a long email stays typing', () => {
    const onTyping = vi.fn();
    const keyboard = start(onTyping);

    keyboard.press(30);
    vi.setSystemTime(Date.now() + TYPING_REPORT_EVERY_MS + 1);
    keyboard.press(31);

    expect(onTyping).toHaveBeenCalledTimes(2);
  });

  it('does not count the talk key, because reaching for the microphone is not typing', () => {
    const onTyping = vi.fn();
    start(onTyping).press(RIGHT_CTRL_KEYCODE);

    expect(onTyping).toHaveBeenCalledTimes(0);
  });

  it('reports nothing about the key itself', () => {
    const onTyping = vi.fn();
    start(onTyping).press(30);

    expect(onTyping).toHaveBeenCalledWith();
  });

  it('works on a hook nobody asked for typing from', () => {
    const keyboard = fakeKeyboard();
    const hook = new HoldToTalkHook({ onEffect: () => undefined, loadHook: () => keyboard.hook });

    expect(hook.start()).toBe(true);
    expect(() => keyboard.press(30)).not.toThrow();
  });
});

describe('an aside waiting for a gap', () => {
  /** A moment with room in it: quiet, listening, nothing said recently. */
  const roomy: AsideMoment = {
    phase: 'listening',
    standby: false,
    quietForMs: 60_000,
    sinceLastAsideMs: Number.POSITIVE_INFINITY,
  };

  it('speaks into a gap that is genuinely empty', () => {
    expect(mayMentionAside(roomy)).toBe(true);
  });

  it('waits while the user is typing', () => {
    expect(mayMentionAside({ ...roomy, userIsTyping: true })).toBe(false);
  });

  it('treats an unanswered typing question as not typing', () => {
    expect(mayMentionAside({ ...roomy, userIsTyping: undefined })).toBe(true);
  });

  // The three below are the defect: `DelegatedTasks` named the fields it read,
  // so the conversation's answers to these never arrived and a completion was
  // announced over a hush.
  it('obeys a hush', () => {
    expect(mayMentionAside({ ...roomy, hushed: true })).toBe(false);
  });

  it('obeys the off switch', () => {
    expect(mayMentionAside({ ...roomy, enabled: false })).toBe(false);
  });

  it('waits while the talk key is held', () => {
    expect(mayMentionAside({ ...roomy, holdingToTalk: true })).toBe(false);
  });
});
