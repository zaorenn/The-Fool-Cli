/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcMain } from 'electron';
import type { ScreenCapture } from './screenCapture';

/**
 * The three ways the renderer can ask for a picture of the screen.
 *
 * All pull-only, and the most any of them can do is take a screenshot the user
 * could have taken themselves. Only one takes an argument, and it can only
 * *narrow* the picture: a window name, which either matches something already on
 * screen or falls back to the same whole display the argument-less handler
 * returns. Nothing here can be aimed at a display or a rectangle of the
 * caller's choosing.
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

  ipcMain.handle('voice:capture-window', async (_event, payload: { match?: string }): Promise<ScreenCapture | null> => {
    const { captureWindow } = await import('./screenCapture');
    return captureWindow(typeof payload?.match === 'string' ? payload.match : '');
  });

  /**
   * Which window a name refers to — a title and an id, and no pixels.
   *
   * The renderer takes the picture itself from the id, through a stream that
   * carries only that window. Doing it here instead would mean asking
   * `getSources` for thumbnails, and it renders one for every open window
   * whether or not anybody wanted it.
   *
   * Null means no window matches, which is an answer the caller must report as
   * one rather than widening to the display.
   */
  ipcMain.handle(
    'voice:resolve-window',
    async (_event, payload: { match?: string }): Promise<{ id: string; name: string } | null> => {
      const { resolveWindowSource } = await import('./screenCapture');
      return resolveWindowSource(typeof payload?.match === 'string' ? payload.match : '');
    }
  );

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
