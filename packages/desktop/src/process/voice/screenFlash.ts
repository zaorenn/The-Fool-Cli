/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserWindow, screen } from 'electron';

/**
 * A border of light around the desktop, once, when the screen is read.
 *
 * An assistant that can look at your screen and gives no sign of when it did is
 * asking to be trusted about the one thing the user cannot check. The answer it
 * speaks proves nothing: it is the same sentence whether it looked a second ago,
 * looked a minute ago, or made the whole thing up. So the capture itself is made
 * visible, at the moment it happens, on the screen that was read.
 *
 * The edges rather than a full-screen wash: a flash over the whole display would
 * be in the way of the very thing being captured, and would land in the picture
 * on a slower machine. A frame draws the eye without covering anything.
 *
 * Every display gets one, because a look captures the display the pointer is on
 * and the user may well be looking at another.
 */

/** Long enough to register, short enough not to sit in the captured image. */
const FLASH_MS = 620;

/** The band of light, in logical pixels — thick enough to see at a glance. */
const EDGE_PX = 10;

/**
 * The overlay's whole content, as a document rather than a file.
 *
 * Inline because there is nothing here to build: no preload, no script, no
 * channel back. The window opens, an animation runs, the window is destroyed —
 * a renderer entry and a build step for that would be more machinery than the
 * thing it draws.
 */
const documentFor = (durationMs: number, edge: number): string => `
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  .frame {
    position: fixed;
    inset: 0;
    box-sizing: border-box;
    border: ${edge}px solid rgba(120, 190, 255, 0.95);
    box-shadow: inset 0 0 ${edge * 4}px rgba(120, 190, 255, 0.55);
    opacity: 0;
    animation: pulse ${durationMs}ms ease-in-out forwards;
  }
  @keyframes pulse {
    0%   { opacity: 0; }
    18%  { opacity: 1; }
    55%  { opacity: 1; }
    100% { opacity: 0; }
  }
</style>
<div class="frame"></div>`;

/** The overlays currently on screen, so a second look replaces the first. */
let showing: BrowserWindow[] = [];

const dismissAll = (): void => {
  const windows = showing;
  showing = [];
  for (const window of windows) {
    if (!window.isDestroyed()) window.destroy();
  }
};

/**
 * Flashes every display's edges, and returns once they are gone.
 *
 * Deliberately not awaited by the capture it announces: the picture should be
 * taken while the light is still on, so that what the user saw and what the
 * assistant read are the same moment. Failing to draw it is not a reason to fail
 * a capture, so everything here is swallowed.
 */
export const flashScreenEdges = (): void => {
  dismissAll();

  try {
    for (const display of screen.getAllDisplays()) {
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
        // Nothing here is for clicking, and a window that took the mouse would
        // steal a click from whatever the user is actually working in.
        focusable: false,
        show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
      });

      window.setIgnoreMouseEvents(true);
      window.setAlwaysOnTop(true, 'screen-saver');
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

      showing.push(window);

      window.webContents.once('did-finish-load', () => {
        if (!window.isDestroyed()) window.showInactive();
      });

      void window
        .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(documentFor(FLASH_MS, EDGE_PX))}`)
        .catch((): void => undefined);
    }
  } catch (error) {
    console.error('[ScreenFlash] the capture could not be shown:', error instanceof Error ? error.message : error);
  }

  setTimeout(dismissAll, FLASH_MS);
};
