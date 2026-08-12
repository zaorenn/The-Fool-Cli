/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('petAPI', {
  onStateChange: (cb: (state: string) => void) => {
    ipcRenderer.on('pet:state-changed', (_e, state: string) => cb(state));
  },
  onEyeMove: (cb: (data: { eyeDx: number; eyeDy: number; bodyDx: number; bodyRotate: number }) => void) => {
    ipcRenderer.on('pet:eye-move', (_e, data) => cb(data));
  },
  onResize: (cb: (size: number) => void) => {
    ipcRenderer.on('pet:resize', (_e, size: number) => cb(size));
  },
  /**
   * What the voice loop is doing, so the pet can say it in words as well as in
   * its pose. Text arrives already translated.
   *
   * `level` and `accent` are what the orb draws from — this window can see
   * neither the microphone nor the app's stylesheets, so both come as values.
   */
  onVoiceStage: (
    cb: (data: {
      stage: string;
      level: number;
      orbSkin: string;
      stageLabel: string;
      notice: string;
      accent: string;
    }) => void
  ) => {
    ipcRenderer.on('pet:voice-stage', (_e, data) => cb(data));
  },
});
