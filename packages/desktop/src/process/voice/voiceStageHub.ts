/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { VOICE_STAGE_OFF, type VoiceStage, type VoiceStageEvent } from '@/common/types/voiceStage';
import type { PetState } from '@process/pet/petTypes';
import { destroyCaptionWindow, repositionCaptionWindow, updateCaption } from './captionWindow';

/**
 * Fans the voice stage out to the surfaces that show it.
 *
 * The main window owns the voice loop and is the only place that knows what is
 * happening; the pet window and the caption strip are read-outs. This hub is the
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
let lastStage: VoiceStage = 'off';
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
  updateCaption(event);

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

/**
 * Starts listening for stage events.
 *
 * Runs at import time alongside the other bridges, which is *before* Electron is
 * ready — so nothing here may touch `screen`, `BrowserWindow` or anything else
 * that needs the app to have started. Both live in the caption window, which is
 * only ever created in response to an event.
 */
export function initVoiceStageHub(): void {
  unsubscribe?.();
  unsubscribe = ipcBridge.foolVoice.stage.on(handle);

  // The tray shows whether the microphone is open and offers to close it. The
  // renderer owns the setting, so it says; this only relays.
  unsubscribeWakeListening?.();
  unsubscribeWakeListening = ipcBridge.foolVoice.wakeListening.on(({ listening }) => {
    void import('@process/utils/tray').then(({ setTrayWakeListening }) => setTrayWakeListening(listening));
  });
}

export function disposeVoiceStageHub(): void {
  unsubscribe?.();
  unsubscribe = null;
  unsubscribeWakeListening?.();
  unsubscribeWakeListening = null;
  destroyCaptionWindow();
  lastStage = VOICE_STAGE_OFF.stage;
  lastPose = null;
}

export function getVoiceStage(): VoiceStage {
  return lastStage;
}
