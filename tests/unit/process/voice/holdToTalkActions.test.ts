/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { voiceActionsFor } from '@process/voice/holdToTalkActions';
import { HoldToTalk } from '@process/voice/holdToTalk';

/**
 * `pushToTalk` is a toggle. Every press opens the microphone and something has
 * to close it, so these tests count opens against closes rather than checking
 * each effect in isolation — an unbalanced toggle is exactly the bug that
 * shipped, and it is invisible from any single effect.
 */
describe('voiceActionsFor', () => {
  it('starts a conversation when the key goes down', () => {
    expect(voiceActionsFor({ kind: 'start' }, 'off')).toEqual([{ kind: 'start-conversation' }]);
  });

  /**
   * The toggle these used to balance is gone. A conversation is not opened by a
   * press and closed by the release — somebody who pressed the key to start
   * talking has not finished talking when they let go of it.
   */
  it('does nothing on commit or on either cancel, because there is no toggle left', () => {
    expect(voiceActionsFor({ kind: 'commit', heldMs: 900 }, 'listening')).toEqual([]);
    expect(voiceActionsFor({ kind: 'cancel', reason: 'combination' }, 'listening')).toEqual([]);
    expect(voiceActionsFor({ kind: 'cancel', reason: 'too-short' }, 'listening')).toEqual([]);
  });

  it('interrupts instead of opening a turn while a reply is being spoken', () => {
    expect(voiceActionsFor({ kind: 'start' }, 'speaking')).toEqual([{ kind: 'interrupt-speech' }]);
  });

  /** The regression: a capture that did not close the turn its own press opened. */
  /**
   * No balancing close any more. That toggle existed because the press
   * beginning this gesture had opened a dictation turn; a press now starts a
   * conversation instead, and closing a turn nobody opened would invert the
   * next gesture — the same fault it was written to prevent, reached from the
   * other side.
   */
  it('captures without closing a turn nobody opened', () => {
    expect(voiceActionsFor({ kind: 'capture-region' }, 'listening')).toEqual([{ kind: 'capture-region' }]);
  });
});

/**
 * The real sequence, driven through the state machine rather than asserted
 * effect by effect. If the toggles do not balance here, the microphone is left
 * open on the user's machine.
 */
describe('a whole gesture leaves the microphone closed', () => {
  const toggles = (effects: Array<ReturnType<HoldToTalk['press']>>, stage: 'off' | 'listening' = 'off'): number =>
    effects
      .filter((effect): effect is NonNullable<typeof effect> => effect !== null)
      .flatMap((effect) => voiceActionsFor(effect, stage))
      .filter((action) => action.kind === 'toggle-turn').length;

  it('balances for a spoken turn', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 180, doubleTapWindowMs: 400 });
    const effects = [hold.press(1000), hold.release(1800)];

    expect(toggles(effects) % 2).toBe(0);
  });

  it('balances for a combination like RightCtrl+C', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 180, doubleTapWindowMs: 400 });
    const effects = [hold.press(1000), hold.otherKeyPressed(), hold.release(1100)];

    expect(toggles(effects) % 2).toBe(0);
  });

  it('balances for a single stray tap', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 180, doubleTapWindowMs: 400 });
    const effects = [hold.press(1000), hold.release(1050)];

    expect(toggles(effects) % 2).toBe(0);
  });

  it('opens no dictation turn at all during a double tap', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 180, doubleTapWindowMs: 400 });
    const effects = [hold.press(1000), hold.release(1050), hold.press(1150), hold.release(1200)];

    // The toggle this used to count is gone: a press starts a conversation and
    // a release does nothing, so there is no microphone left open to balance.
    expect(toggles(effects)).toBe(0);
  });

  it('captures exactly once for a double tap', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 180, doubleTapWindowMs: 400 });
    const captures = [hold.press(1000), hold.release(1050), hold.press(1150), hold.release(1200)]
      .filter((effect): effect is NonNullable<typeof effect> => effect !== null)
      .flatMap((effect) => voiceActionsFor(effect, 'off'))
      .filter((action) => action.kind === 'capture-region');

    expect(captures).toHaveLength(1);
  });
});

/**
 * `RightCtrl+V`. The combination is watched, never claimed — V is paste, and
 * paste has to keep working everywhere.
 */
describe('stopping wake listening with the V combination', () => {
  it('reports the stop and still abandons the hold, so the paste goes through', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 180, doubleTapWindowMs: 400 });

    hold.press(1000);
    const stop = hold.stopKeyPressed();
    const abandon = hold.otherKeyPressed();

    expect(stop).toEqual({ kind: 'stop-wake-listening' });
    // The combination rule still fires. That is what releases the keystroke to
    // whatever the user is typing into.
    expect(abandon).toEqual({ kind: 'cancel', reason: 'combination' });
  });

  it('means nothing when the talk key is not held', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 180, doubleTapWindowMs: 400 });

    // A bare V is typing.
    expect(hold.stopKeyPressed()).toBeNull();

    hold.press(1000);
    hold.release(1800);
    expect(hold.stopKeyPressed()).toBeNull();
  });

  it('does not open or close a turn on its own', () => {
    expect(voiceActionsFor({ kind: 'stop-wake-listening' }, 'listening')).toEqual([{ kind: 'stop-wake-listening' }]);
  });

  it('leaves the microphone toggle balanced across the whole combination', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 180, doubleTapWindowMs: 400 });
    const effects = [hold.press(1000), hold.stopKeyPressed(), hold.otherKeyPressed(), hold.release(1100)];

    const opens = effects
      .filter((effect): effect is NonNullable<typeof effect> => effect !== null)
      .flatMap((effect) => voiceActionsFor(effect, 'listening'))
      .filter((action) => action.kind === 'toggle-turn').length;

    expect(opens % 2).toBe(0);
  });

  it('still lets an ordinary combination cancel without stopping listening', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 180, doubleTapWindowMs: 400 });

    hold.press(1000);
    const actions = voiceActionsFor(hold.otherKeyPressed()!, 'listening');

    expect(actions.some((action) => action.kind === 'stop-wake-listening')).toBe(false);
  });

  /**
   * Once a spoken conversation is open, the key is its microphone and nothing
   * else.
   *
   * Reported as "hold-to-talk works the first time and is completely dead
   * afterwards, and it listens the whole time". Two things were driving off the
   * same key: the conversation's own microphone and the notch turn behind it —
   * and the notch's second gesture, two taps for a screen region, opens a turn
   * it never closes.
   */
  describe('while a conversation owns the key', () => {
    it('drives nothing but the conversation, whatever the gesture', () => {
      const effects = [
        { kind: 'start' } as const,
        { kind: 'commit', heldMs: 900 } as const,
        { kind: 'cancel', reason: 'too-short' } as const,
        { kind: 'capture-region' } as const,
        { kind: 'stop-wake-listening' } as const,
      ];

      for (const effect of effects) {
        expect(voiceActionsFor(effect, 'listening', true)).toEqual([]);
      }
    });

    it('does not even interrupt the reply, which the conversation handles itself', () => {
      expect(voiceActionsFor({ kind: 'start' }, 'speaking', true)).toEqual([]);
    });

    it('can start a new one once the conversation is closed', () => {
      expect(voiceActionsFor({ kind: 'start' }, 'off', false)).toEqual([{ kind: 'start-conversation' }]);
    });
  });
});

/**
 * What the key is for, once there is a conversation to have.
 *
 * The key was built when the only thing it could open was a dictation turn: a
 * one-shot transcribe-think-speak loop drawn in the notch. There is now a real
 * spoken conversation, and pressing the key from the desktop to dictate one
 * sentence at the notch is not what anybody reaches for — they want to talk to
 * it. So a plain press with nothing running starts the conversation, and once it
 * is running the key is its microphone and nothing else.
 *
 * The other gestures the key carries are untouched. Answering the notch's
 * permission request with a digit and grabbing a region with a double tap are
 * different gestures, not different meanings for the same press, and taking them
 * away would remove shipped features nothing here asked to remove.
 */
describe('the key with no conversation running', () => {
  it('starts the conversation rather than opening a dictation turn', () => {
    expect(voiceActionsFor({ kind: 'start' }, 'off')).toEqual([{ kind: 'start-conversation' }]);
  });

  it('does not also close something, because a conversation is not a toggle', () => {
    const actions = voiceActionsFor({ kind: 'commit', heldMs: 900 }, 'off');
    expect(actions).not.toContainEqual({ kind: 'toggle-turn' });
  });

  it('still interrupts a reply rather than starting a second conversation', () => {
    expect(voiceActionsFor({ kind: 'start' }, 'speaking')).toEqual([{ kind: 'interrupt-speech' }]);
  });

  it('still answers the notch with a digit', () => {
    expect(voiceActionsFor({ kind: 'choose-option', index: 1 }, 'off')).toEqual([{ kind: 'choose-option', index: 1 }]);
  });

  it('still grabs a region on a double tap', () => {
    expect(voiceActionsFor({ kind: 'capture-region' }, 'off')).toContainEqual({ kind: 'capture-region' });
  });
});

describe('the key once a conversation is running', () => {
  it('is left to the conversation, which reads it directly', () => {
    expect(voiceActionsFor({ kind: 'start' }, 'listening', true)).toEqual([]);
    expect(voiceActionsFor({ kind: 'commit', heldMs: 900 }, 'listening', true)).toEqual([]);
  });

  it('does not start a second one', () => {
    expect(voiceActionsFor({ kind: 'start' }, 'off', true)).not.toContainEqual({ kind: 'start-conversation' });
  });
});
