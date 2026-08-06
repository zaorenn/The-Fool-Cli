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
  | { kind: 'capture-region' }
  /** Answer the permission request the notch is showing. Zero-based. */
  | { kind: 'choose-option'; index: number }
  /** Switch always-on wake listening off. */
  | { kind: 'stop-wake-listening' };

/**
 * The actions an effect calls for, in order.
 *
 * @param effect what the key's state machine decided
 * @param stage what the voice loop is doing right now
 * @param conversationActive whether a spoken conversation is running
 */
export function voiceActionsFor(
  effect: HoldToTalkEffect,
  stage: VoiceStage,
  conversationActive = false
): VoiceAction[] {
  // While a conversation is running the key is its microphone and nothing else.
  //
  // Everything below drives the notch turn, which is a different session with a
  // different microphone: pressing the key opened both at once, and the second
  // gesture the key carries — two taps to grab a region — opened one of them
  // without closing it. The conversation reads the key's own up/down events
  // directly, so leaving it to them here is not a loss of function.
  if (conversationActive) return [];

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

  // A digit answering a request is not part of a turn at all: no press opened
  // the microphone, so there is nothing here to balance. Before the toggle
  // below, and deliberately so — falling through to it would have every answer
  // switch the microphone on.
  if (effect.kind === 'choose-option') {
    return [{ kind: 'choose-option', index: effect.index }];
  }

  // `RightCtrl+V`. No toggle here either: the hold this arrived during is
  // abandoned a moment later by the ordinary combination rule, and that cancel
  // carries the close. Balancing it here as well would shut a turn nobody
  // opened and leave the next press inverted — the same fault the capture had.
  if (effect.kind === 'stop-wake-listening') {
    return [{ kind: 'stop-wake-listening' }];
  }

  // `start` opens the turn; `commit` and both cancels close the one it opened.
  return [{ kind: 'toggle-turn' }];
}
