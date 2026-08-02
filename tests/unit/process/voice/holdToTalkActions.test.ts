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
  it('opens a turn when the key goes down', () => {
    expect(voiceActionsFor({ kind: 'start' }, 'off')).toEqual([{ kind: 'toggle-turn' }]);
  });

  it('closes it on commit and on either cancel', () => {
    expect(voiceActionsFor({ kind: 'commit', heldMs: 900 }, 'listening')).toEqual([{ kind: 'toggle-turn' }]);
    expect(voiceActionsFor({ kind: 'cancel', reason: 'combination' }, 'listening')).toEqual([{ kind: 'toggle-turn' }]);
    expect(voiceActionsFor({ kind: 'cancel', reason: 'too-short' }, 'listening')).toEqual([{ kind: 'toggle-turn' }]);
  });

  it('interrupts instead of opening a turn while a reply is being spoken', () => {
    expect(voiceActionsFor({ kind: 'start' }, 'speaking')).toEqual([{ kind: 'interrupt-speech' }]);
  });

  /** The regression: a capture that did not close the turn its own press opened. */
  it('closes the turn the second press opened before capturing', () => {
    expect(voiceActionsFor({ kind: 'capture-region' }, 'listening')).toEqual([
      { kind: 'toggle-turn' },
      { kind: 'capture-region' },
    ]);
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

  it('balances for a double tap that captures a region', () => {
    const hold = new HoldToTalk({ minimumHoldMs: 180, doubleTapWindowMs: 400 });
    const effects = [hold.press(1000), hold.release(1050), hold.press(1150), hold.release(1200)];

    // Four presses and releases: two opens from the presses, and the closes
    // have to match — including the one on the release that reports the capture.
    expect(toggles(effects)).toBe(4);
    expect(toggles(effects) % 2).toBe(0);
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
