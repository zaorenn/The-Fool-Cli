/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * The selection overlay only ever answers once, with a rectangle or with
 * nothing, so that is the entire surface it is given.
 */
contextBridge.exposeInMainWorld('regionSelectAPI', {
  done: (selection: { x: number; y: number; width: number; height: number } | null) => {
    ipcRenderer.send('voice:region-select-result', selection);
  },
});
