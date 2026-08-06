/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { VOICE_STAGE_OFF, type VoiceStage, type VoiceStageEvent } from '@/common/types/voiceStage';
import type { PetState } from '@process/pet/petTypes';
import {
  destroyFoolsControl,
  repositionFoolsControl,
  setFoolsControlPermission,
  updateFoolsControl,
} from './foolsControlWindow';
import { HoldToTalkHook } from './holdToTalkHook';
import { voiceActionsFor } from './holdToTalkActions';

/**
 * Fans the voice stage out to the surfaces that show it.
 *
 * The main window owns the voice loop and is the only place that knows what is
 * happening; the pet window and Fool's Control are read-outs. This hub is the
 * one place that decides which pose and which strip go with which stage, so the
 * two can never disagree.
 */

/** Each stage's pose. Anything not listed leaves the pet as it was. */
const POSE: Partial<Record<VoiceStage, PetState>> = {
  listening: 'voice-listening',
  hearing: 'voice-listening',
  processing: 'voice-thinking',
  generating: 'voice-thinking',
  speaking: 'voice-speaking',
};

type PetBridge = {
  /** Sends the stage to the pet window for its label. */
  send: (event: VoiceStageEvent) => void;
  /** Puts the pet into a pose, bypassing the ambient state machine. */
  pose: (state: PetState) => void;
  /** True when the user asked not to be disturbed. */
  isMuted: () => boolean;
};

let petBridge: PetBridge | null = null;
let unsubscribe: (() => void) | null = null;
let unsubscribeWakeListening: (() => void) | null = null;
let unsubscribePermission: (() => void) | null = null;
let unsubscribeConversation: (() => void) | null = null;
let lastStage: VoiceStage = 'off';
/**
 * Whether the wake word is currently holding the microphone.
 *
 * Cached from the renderer's own announcements so `RightCtrl+V` can be a no-op
 * when there is nothing to stop. Without this every paste made with the right
 * Ctrl key would be doing invisible work.
 */
let wakeListening = false;
/** The pose currently asked for, so a repeated stage does not re-request it. */
let lastPose: PetState | 'idle' | null = null;

/** Called by the pet manager as its windows come and go. */
export function setPetStageBridge(bridge: PetBridge | null): void {
  petBridge = bridge;
  lastPose = null;
  if (!bridge) return;
  // A pet that appears mid-conversation should join in immediately.
  if (lastStage !== 'off') {
    const pose = POSE[lastStage];
    if (pose && !bridge.isMuted()) bridge.pose(pose);
  }
}

const handle = (event: VoiceStageEvent): void => {
  lastStage = event.stage;
  updateFoolsControl(event);

  if (!petBridge) return;
  petBridge.send(event);

  if (petBridge.isMuted()) return;

  // Level updates arrive many times a second while someone is speaking. The pose
  // for those is the same pose, and re-requesting it would reload the pet's
  // artwork on every frame — so only an actual change is passed on.
  const pose = event.stage === 'off' ? 'idle' : POSE[event.stage];
  if (!pose || pose === lastPose) return;

  lastPose = pose;
  petBridge.pose(pose);
};

let holdToTalk: HoldToTalkHook | null = null;
/**
 * Whether a spoken conversation is open, which changes who the talk key is for.
 *
 * The conversation is in the renderer and the key is read here, so it has to be
 * said rather than observed. Not derived from the stage: the notch turn reports
 * the same stages, and the two want opposite handling of the same key.
 */
let conversationActive = false;

/**
 * Draws the overlay, captures what was drawn, and hands it to the composer.
 *
 * The window modules are imported lazily for the reason given on
 * `initVoiceStageHub`: this file is loaded before Electron is ready, and
 * anything that touches `screen` or `BrowserWindow` at import time takes the
 * app down. Nothing is raised when the user cancels — an overlay dismissed with
 * Escape should leave no trace.
 */
const captureRegionToComposer = async (): Promise<void> => {
  try {
    const [{ captureSelection }, { selectRegion }] = await Promise.all([
      import('./screenCapture'),
      import('./regionSelectWindow'),
    ]);

    const chosen = await selectRegion();
    if (!chosen) return;

    const shot = await captureSelection(chosen.display, chosen.selection);
    if (!shot) {
      console.warn('[HoldToTalk] the region was selected but could not be captured');
      return;
    }
    ipcBridge.foolVoice.regionCaptured.emit(shot);
  } catch (error) {
    console.warn('[HoldToTalk] the region capture failed', error);
  }
};

/**
 * Hold right Ctrl to talk.
 *
 * Mapped onto the push-to-talk event the shortcut already raises, which is a
 * toggle: the first one opens the turn and the second closes it. So the key
 * going down opens it and the key coming up closes it, and every path that ends
 * a turn today — the notch retracting, the reply being spoken — is reused
 * unchanged rather than given a second implementation to drift from.
 *
 * A cancel closes the turn the same way, because by then it is already open: the
 * combination rule fires while the key is still down, so `RightCtrl+C` opens the
 * microphone for a few milliseconds and then shuts it, and the copy goes through
 * to the app underneath untouched.
 *
 * Two quick taps mean something else entirely — point at the screen rather than
 * talk about it — and never open a turn at all.
 */
const startHoldToTalk = (): void => {
  holdToTalk?.stop();
  holdToTalk = new HoldToTalkHook({
    onEffect: (effect) => {
      // The two edges, before they are collapsed into a toggle below. A spoken
      // conversation runs its own microphone and needs to know how long the key
      // was held, which a toggle cannot say.
      //
      // `start` is the only effect that opens; every other one ends the hold,
      // and *every* other one has to say so. Listing the two obvious ones was
      // the bug: two quick taps report `capture-region` instead of a cancel, so
      // the close never arrived, the microphone stayed open for good, and every
      // press after it arrived at a gate that was already open — heard once,
      // then dead, and listening the whole time.
      ipcBridge.foolVoice.holdToTalk.emit({ holding: effect.kind === 'start' });

      // What to do about the decision lives in `holdToTalkActions`, where it can
      // be tested without Electron. It was inline here, and being inline is how
      // a capture came to leave the microphone open: the branch handled the
      // gesture and returned without closing the turn its own press had opened.
      for (const action of voiceActionsFor(effect, lastStage, conversationActive)) {
        switch (action.kind) {
          case 'toggle-turn':
            ipcBridge.foolVoice.pushToTalk.emit();
            break;
          case 'interrupt-speech':
            ipcBridge.foolVoice.interruptSpeech.emit();
            break;
          case 'capture-region':
            void captureRegionToComposer();
            break;
          case 'choose-option':
            // Back to the panel that drew the request, which resolves it
            // exactly as a click on the same option would.
            ipcBridge.foolVoice.permissionChoice.emit({ index: action.index });
            break;
          case 'stop-wake-listening':
            // Nothing running, nothing to stop — and saying so anyway would
            // make every `Ctrl+V` toggle the microphone *on*, since the channel
            // below is the tray's toggle rather than an explicit off.
            if (wakeListening) {
              void import('@process/utils/tray').then(({ requestWakeListeningOff }) => requestWakeListeningOff());
            }
            break;
        }
      }

      if (effect.kind === 'cancel') {
        console.info(`[HoldToTalk] turn abandoned: ${effect.reason}`);
      }
    },
    logWarn: (message, error) => console.warn(message, error),
  });

  if (holdToTalk.start()) {
    console.info('[HoldToTalk] listening for right Ctrl');
  } else {
    // The native hook is optional: without it the app keeps the shortcut it
    // always had, and only hold-to-talk is missing.
    holdToTalk = null;
  }
};

/**
 * Starts listening for stage events.
 *
 * Runs at import time alongside the other bridges, which is *before* Electron is
 * ready — so nothing here may touch `screen`, `BrowserWindow` or anything else
 * that needs the app to have started. Both live in the Fool's Control window, which is
 * only ever created in response to an event.
 */
export function initVoiceStageHub(): void {
  unsubscribe?.();
  unsubscribe = ipcBridge.foolVoice.stage.on(handle);

  startHoldToTalk();

  // The tray shows whether the microphone is open and offers to close it. The
  // renderer owns the setting, so it says; this only relays.
  unsubscribeWakeListening?.();
  unsubscribeWakeListening = ipcBridge.foolVoice.wakeListening.on(({ listening }) => {
    wakeListening = listening;
    void import('@process/utils/tray').then(({ setTrayWakeListening }) => setTrayWakeListening(listening));
  });

  // A conversation claiming the talk key, for as long as it is open.
  unsubscribeConversation?.();
  unsubscribeConversation = ipcBridge.foolVoice.conversationActive.on(({ active }) => {
    conversationActive = active;
  });

  // A permission request the app is waiting on: onto the notch, and the digits
  // that answer it are read from the keyboard for exactly as long as it is open.
  unsubscribePermission?.();
  unsubscribePermission = ipcBridge.foolVoice.permissionRequest.on((request) => {
    setFoolsControlPermission(request);
    holdToTalk?.setPendingChoices(request ? request.options.length : 0);
  });
}

export function disposeVoiceStageHub(): void {
  holdToTalk?.stop();
  holdToTalk = null;
  unsubscribe?.();
  unsubscribe = null;
  unsubscribeWakeListening?.();
  unsubscribeWakeListening = null;
  unsubscribePermission?.();
  unsubscribePermission = null;
  unsubscribeConversation?.();
  unsubscribeConversation = null;
  conversationActive = false;
  destroyFoolsControl();
  lastStage = VOICE_STAGE_OFF.stage;
  lastPose = null;
}

export function getVoiceStage(): VoiceStage {
  return lastStage;
}
