/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HoldToTalkEffect } from './holdToTalk';
import type { VoiceStage } from '@/common/types/voiceStage';

/**
 * What the app should do about a decision the key made.
 *
 * Pulled out of the stage hub so it can be tested without Electron. It is a
 * small mapping and it was wrong: the bug it exists to prevent is not a subtle
 * one, but it was invisible while it lived inline among IPC calls.
 *
 * The thing to hold on to is that `pushToTalk` is a **toggle**, not a command.
 * Every `start` opens the microphone, and something has to close it. A branch
 * that handles an effect and returns without balancing the toggle leaves the
 * microphone open for good and inverts every gesture that follows.
 */
export type VoiceAction =
  /** Flip the push-to-talk toggle: opens a turn, or closes the open one. */
  | { kind: 'toggle-turn' }
  /** Silence a reply being read aloud, without ending the session. */
  | { kind: 'interrupt-speech' }
  /** Draw a box on the screen and put what is inside it in the composer. */
  | { kind: 'capture-region' };

/**
 * The actions an effect calls for, in order.
 *
 * @param effect what the key's state machine decided
 * @param stage what the voice loop is doing right now
 */
export function voiceActionsFor(effect: HoldToTalkEffect, stage: VoiceStage): VoiceAction[] {
  // Pressed while the reply is being read, the key means "stop talking" — the
  // natural thing to reach for when the answer is already long enough. It
  // silences the reply without ending the session, and opens no turn, so there
  // is no toggle to balance.
  if (effect.kind === 'start' && stage === 'speaking') {
    return [{ kind: 'interrupt-speech' }];
  }

  // A double tap is two presses and two releases. Every one of those presses
  // already opened a turn and every release so far has closed one — except this
  // release, which is reporting the gesture instead. So the toggle it inherited
  // is still open, and closing it is not optional: without this the microphone
  // stays live after every capture and the next press closes it instead of
  // opening one.
  if (effect.kind === 'capture-region') {
    return [{ kind: 'toggle-turn' }, { kind: 'capture-region' }];
  }

  // `start` opens the turn; `commit` and both cancels close the one it opened.
  return [{ kind: 'toggle-turn' }];
}
