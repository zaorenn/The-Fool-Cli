/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { FoolsControlPayload } from '@/common/types/voiceStage';

/**
 * Fool's Control has no controls. The permission request it shows is answered
 * from the desktop-wide key hook in the main process rather than from this
 * window, which is what lets it stay unfocusable and click-through while
 * carrying a question.
 *
 * The one thing it sends is the size of the notch it has drawn, which is the
 * only fact the main process cannot work out for itself: the window is a fixed
 * box and the notch grows and shrinks inside it in CSS. Knowing where the notch
 * actually is, is what makes "the pointer is over it" answerable — and the
 * pointer is read in the main process, from the system cursor, rather than from
 * a forwarded mouse event that stops arriving the moment it leaves.
 */
contextBridge.exposeInMainWorld('foolsControlAPI', {
  onStage: (callback: (event: FoolsControlPayload) => void) => {
    const handler = (_event: unknown, payload: FoolsControlPayload) => callback(payload);
    ipcRenderer.on('voice:fools-control', handler);
    return () => {
      ipcRenderer.off('voice:fools-control', handler);
    };
  },

  /** Whether the cursor is over the notch right now, decided in the main process. */
  onPointer: (callback: (over: boolean) => void) => {
    const handler = (_event: unknown, over: boolean) => callback(over);
    ipcRenderer.on('voice:fools-control-pointer', handler);
    return () => {
      ipcRenderer.off('voice:fools-control-pointer', handler);
    };
  },

  /** Where the notch is drawn inside the window, in CSS pixels. */
  reportBounds: (bounds: { x: number; y: number; width: number; height: number }) => {
    ipcRenderer.send('voice:fools-control-bounds', bounds);
  },
});
