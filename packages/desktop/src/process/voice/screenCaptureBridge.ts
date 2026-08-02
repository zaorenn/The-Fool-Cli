/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcMain } from 'electron';
import type { ScreenCapture } from './screenCapture';

/**
 * The two ways the renderer can ask for a picture of the screen.
 *
 * Both are pull-only and both are user-initiated: nothing here can be triggered
 * by a model, and neither handler takes an argument, so a compromised renderer
 * cannot aim the camera at a display or a rectangle of its choosing. The most it
 * can do is take the same screenshot the user could have taken.
 *
 * The capture modules are imported inside the handlers, not at the top: the
 * bridges are wired at module scope, which is *before* Electron is ready, and
 * those modules reach for `screen` and the app's language. Only the types cross
 * the boundary up here.
 *
 * Registered once. `initScreenCaptureBridge` is called from the same place the
 * other voice bridges are wired.
 */

let registered = false;

export function initScreenCaptureBridge(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle('voice:capture-screen', async (): Promise<ScreenCapture | null> => {
    const { captureScreen } = await import('./screenCapture');
    return captureScreen();
  });

  ipcMain.handle('voice:capture-screen-region', async (): Promise<ScreenCapture | null> => {
    const [{ captureSelection }, { selectRegion }] = await Promise.all([
      import('./screenCapture'),
      import('./regionSelectWindow'),
    ]);

    const chosen = await selectRegion();
    // Cancelled. Not an error, and deliberately not a whole-screen fallback:
    // pressing Escape means "do not send a picture", not "send all of it".
    if (!chosen) return null;
    return captureSelection(chosen.display, chosen.selection);
  });
}
