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

// ... (ilk fonksiyonlar - var olan kod)

function disposeVoiceStageHub(): void {
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

export default disposeVoiceStageHub;
// ... (diğer fonksiyonlar - var olan kod)