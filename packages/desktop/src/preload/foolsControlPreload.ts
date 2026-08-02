/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { VoiceStageEvent } from '@/common/types/voiceStage';

/**
 * Fool's Control only ever receives. It has no controls, so it is given no
 * way to send anything back.
 */
contextBridge.exposeInMainWorld('foolsControlAPI', {
  onStage: (callback: (event: VoiceStageEvent) => void) => {
    const handler = (_event: unknown, payload: VoiceStageEvent) => callback(payload);
    ipcRenderer.on('voice:fools-control', handler);
    return () => {
      ipcRenderer.off('voice:fools-control', handler);
    };
  },
});
