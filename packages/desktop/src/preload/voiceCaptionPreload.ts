/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { VoiceStageEvent } from '@/common/types/voiceStage';

/**
 * The caption strip only ever receives. It has no controls, so it is given no
 * way to send anything back.
 */
contextBridge.exposeInMainWorld('voiceCaptionAPI', {
  onCaption: (callback: (event: VoiceStageEvent) => void) => {
    const handler = (_event: unknown, payload: VoiceStageEvent) => callback(payload);
    ipcRenderer.on('voice:caption', handler);
    return () => {
      ipcRenderer.off('voice:caption', handler);
    };
  },
});
