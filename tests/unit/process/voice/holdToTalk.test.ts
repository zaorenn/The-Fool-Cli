/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { HoldToTalk } from '@process/voice/holdToTalk';

/**
 * Right Ctrl is a key the user still needs. The entire value of this machine is
 * that claiming it for speech does not cost them `RightCtrl+C`.
 */
describe('HoldToTalk', () => {
  it('starts a turn when the key goes down and speaks it on release', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 100 });

    expect(hold.press(1000)).toEqual({ kind: 'start' });
    expect(hold.isHolding).toBe(true);
    expect(hold.release(1900)).toEqual({ kind: 'commit', heldMs: 900 });
    expect(hold.isHolding).toBe(false);
  });

  /**
   * The rule this exists for. Another key joining the hold abandons the turn
   * immediately — not on release — so the microphone closes while the
   * combination is still going through to whatever is underneath.
   */
  it('abandons the turn the moment another key joins the hold', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 100 });

    hold.press(1000);
    expect(hold.otherKeyPressed()).toEqual({ kind: 'cancel', reason: 'combination' });
    expect(hold.isHolding).toBe(false);
  });

  // Saying it twice would have the caller close a microphone it already closed.
  it('does not report the cancel again when the combination is released', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 100 });

    hold.press(1000);
    hold.otherKeyPressed();

    expect(hold.release(2000)).toBeNull();
  });

  it('is ready for a fresh turn after a combination', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 100 });

    hold.press(1000);
    hold.otherKeyPressed();
    hold.release(1200);

    expect(hold.press(3000)).toEqual({ kind: 'start' });
    expect(hold.release(4000)).toEqual({ kind: 'commit', heldMs: 1000 });
  });

  /**
   * A tap on a modifier is almost never someone starting to talk. Opening the
   * microphone for it would put the notch on screen for nothing.
   */
  it('ignores a press too brief to have been speech', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 180 });

    hold.press(1000);

    expect(hold.release(1100)).toEqual({ kind: 'cancel', reason: 'too-short' });
  });

  it('accepts a hold exactly at the threshold', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 180 });

    hold.press(1000);

    expect(hold.release(1180)).toEqual({ kind: 'commit', heldMs: 180 });
  });

  /**
   * A held key repeats at the keyboard's auto-repeat rate. Treating each repeat
   * as a new press would restart the turn every few dozen milliseconds.
   */
  it('treats auto-repeat as one continuous hold', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 100 });

    expect(hold.press(1000)).toEqual({ kind: 'start' });
    expect(hold.press(1030)).toBeNull();
    expect(hold.press(1060)).toBeNull();
    expect(hold.release(1500)).toEqual({ kind: 'commit', heldMs: 500 });
  });

  // Outside a hold, every other key on the keyboard is none of this machine's
  // business — it is fed all of them.
  it('ignores other keys while nothing is held', () => {
    const hold = new HoldToTalk();

    expect(hold.otherKeyPressed()).toBeNull();
    expect(hold.isHolding).toBe(false);
  });

  /**
   * Losing the keyboard mid-hold — the hook torn down, the session locked, the
   * app quitting — must not leave the microphone open for good.
   */
  it('closes an open hold when the keyboard goes away', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 100 });

    hold.press(1000);

    expect(hold.abort()).toEqual({ kind: 'cancel', reason: 'combination' });
    expect(hold.isHolding).toBe(false);
    expect(hold.abort()).toBeNull();
  });

  // A clock that jumps backwards must not produce a negative hold that then
  // passes the minimum check by being compared as a number.
  it('never reports a negative hold', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 0 });

    hold.press(5000);

    expect(hold.release(4000)).toEqual({ kind: 'commit', heldMs: 0 });
  });

  /**
   * The second gesture on the same key.
   *
   * Two quick taps were already dead input — each one is discarded as too short
   * to be speech — so nothing has to be taken away from the user to mean
   * something by them.
   */
  describe('double tap', () => {
    it('asks for a region capture on the second quick tap', () => {
      const hold = new HoldToTalk({ minimumHoldMs: 180, doubleTapWindowMs: 400 });

      hold.press(1000);
      expect(hold.release(1080)).toEqual({ kind: 'cancel', reason: 'too-short' });

      hold.press(1200);
      expect(hold.release(1280)).toEqual({ kind: 'capture-region' });
    });

    it('leaves two taps far apart as two separate misses', () => {
      const hold = new HoldToTalk({ minimumHoldMs: 180, doubleTapWindowMs: 400 });

      hold.press(1000);
      hold.release(1080);

      hold.press(2000);
      expect(hold.release(2080)).toEqual({ kind: 'cancel', reason: 'too-short' });
    });

    it('does not turn three taps into two captures', () => {
      const hold = new HoldToTalk({ minimumHoldMs: 180, doubleTapWindowMs: 400 });

      hold.press(1000);
      hold.release(1080);
      hold.press(1200);
      expect(hold.release(1280)).toEqual({ kind: 'capture-region' });

      // The third tap starts counting again rather than completing a second pair.
      hold.press(1400);
      expect(hold.release(1480)).toEqual({ kind: 'cancel', reason: 'too-short' });
    });

    it('does not read a tap after a spoken turn as half a double tap', () => {
      const hold = new HoldToTalk({ minimumHoldMs: 180, doubleTapWindowMs: 400 });

      hold.press(1000);
      expect(hold.release(1500)).toEqual({ kind: 'commit', heldMs: 500 });

      hold.press(1600);
      expect(hold.release(1680)).toEqual({ kind: 'cancel', reason: 'too-short' });
    });

    it('does not read a tap after an abandoned combination as half a double tap', () => {
      const hold = new HoldToTalk({ minimumHoldMs: 180, doubleTapWindowMs: 400 });

      hold.press(1000);
      hold.otherKeyPressed();
      hold.release(1080);

      hold.press(1200);
      expect(hold.release(1280)).toEqual({ kind: 'cancel', reason: 'too-short' });
    });

    it('never fires when the gesture is switched off', () => {
      const hold = new HoldToTalk({ minimumHoldMs: 180, doubleTapWindowMs: 0 });

      hold.press(1000);
      hold.release(1080);
      hold.press(1100);

      expect(hold.release(1180)).toEqual({ kind: 'cancel', reason: 'too-short' });
    });
  });
});
