/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { FoolsControlPayload } from '@/common/types/voiceStage';

/**
 * Fool's Control only ever receives. It has no controls, so it is given no
 * way to send anything back — the permission request it shows is answered from
 * the desktop-wide key hook in the main process, not from this window, which is
 * why it can stay unfocusable and click-through while carrying a question.
 */
contextBridge.exposeInMainWorld('foolsControlAPI', {
  onStage: (callback: (event: FoolsControlPayload) => void) => {
    const handler = (_event: unknown, payload: FoolsControlPayload) => callback(payload);
    ipcRenderer.on('voice:fools-control', handler);
    return () => {
      ipcRenderer.off('voice:fools-control', handler);
    };
  },
});
