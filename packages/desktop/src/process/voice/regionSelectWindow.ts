/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { app, BrowserWindow, ipcMain, type Display } from 'electron';
import i18n from '@process/services/i18n';
import { activeDisplay } from './screenCapture';
import type { Rect } from './selectionGeometry';

/**
 * Drag a box over the screen.
 *
 * A window covering one whole display, transparent and above everything, that
 * exists only long enough for the user to draw a rectangle. Unlike the notch it
 * *does* take the mouse and the keyboard — it has to, since drawing is the whole
 * point and Escape has to be able to call the whole thing off.
 *
 * The result is a rectangle in the display's own logical pixels. Turning that
 * into a crop of the captured image is `selectionGeometry`'s job, not this
 * file's: the two spaces differ on a scaled display and conflating them is the
 * bug this separation exists to prevent.
 *
 * Its one line of text is translated here and passed in on the URL rather than
 * looked up in the window: like Fool's Control, this renderer has no i18n
 * runtime, and the main process is where the app's language already lives.
 */

/** See the note in `foolsControlWindow.ts`: this module is bundled to out/main. */
const PRELOAD_DIR = path.join(__dirname, '..', 'preload');
const RENDERER_DIR = path.join(__dirname, '..', 'renderer', 'voice');

/** The renderer answers on this channel exactly once per window. */
const RESULT_CHANNEL = 'voice:region-select-result';

/**
 * A selection left open forever would hold the whole screen hostage behind a
 * transparent window the user may not realise is there.
 */
const SELECTION_TIMEOUT_MS = 60000;

let active: BrowserWindow | null = null;

const isRect = (value: unknown): value is Rect => {
  if (typeof value !== 'object' || value === null) return false;
  const rect = value as Record<string, unknown>;
  return (
    typeof rect.x === 'number' &&
    typeof rect.y === 'number' &&
    typeof rect.width === 'number' &&
    typeof rect.height === 'number' &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
};

/**
 * Opens the overlay and resolves with what was drawn, or null.
 *
 * Null covers every way this ends without a selection: Escape, a right-click, a
 * click with no drag, the window being closed, the timeout. The caller treats
 * them all the same — no region, so no capture.
 *
 * Only one overlay at a time. A second request while one is open cancels the
 * first rather than stacking two full-screen windows the user cannot tell apart.
 */
export const selectRegion = async (
  display: Display = activeDisplay()
): Promise<{ display: Display; selection: Rect } | null> => {
  cancelRegionSelect();

  const { x, y, width, height } = display.bounds;

  const window = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    // The opposite of the notch: this one is here to be drawn on.
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(PRELOAD_DIR, 'regionSelectPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  active = window;

  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  return await new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const finish = (result: { display: Display; selection: Rect } | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      ipcMain.removeListener(RESULT_CHANNEL, onResult);
      if (active === window) active = null;
      if (!window.isDestroyed()) window.destroy();
      resolve(result);
    };

    const onResult = (event: Electron.IpcMainEvent, payload: unknown): void => {
      // Any window may reach ipcMain, so the sender is checked rather than
      // assumed: another renderer must not be able to end this selection.
      if (event.sender !== window.webContents) return;
      finish(isRect(payload) ? { display, selection: payload } : null);
    };

    ipcMain.on(RESULT_CHANNEL, onResult);
    window.on('closed', () => finish(null));
    timer = setTimeout(() => finish(null), SELECTION_TIMEOUT_MS);

    window.webContents.once('did-finish-load', () => {
      if (window.isDestroyed()) return;
      window.show();
      window.focus();
    });

    const devUrl = process.env.ELECTRON_RENDERER_URL;
    const file = path.join(RENDERER_DIR, 'regionSelect.html');
    const query = { hint: i18n.t('common.regionSelect.hint') };

    if (!app.isPackaged && devUrl) {
      const url = new URL(`${devUrl}/voice/regionSelect.html`);
      url.searchParams.set('hint', query.hint);
      void window.loadURL(url.toString()).catch((error: Error) => {
        console.error('[RegionSelect] dev URL failed, falling back to file:', error.message);
        void window.loadFile(file, { query }).catch(() => finish(null));
      });
    } else {
      void window.loadFile(file, { query }).catch((error: Error) => {
        console.error('[RegionSelect] could not load the window:', error.message);
        finish(null);
      });
    }
  });
};

/** Closes any open overlay, as if the user had pressed Escape. */
export const cancelRegionSelect = (): void => {
  const window = active;
  active = null;
  if (window && !window.isDestroyed()) window.destroy();
};
