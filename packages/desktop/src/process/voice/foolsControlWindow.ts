/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import { shouldShowCaption, VOICE_STAGE_OFF, type VoiceStageEvent } from '@/common/types/voiceStage';

/**
 * Fool's Control: a notch at the top of the screen that says what the app is
 * doing, while it is doing it.
 *
 * A frameless, transparent, click-through window pinned flush to the top edge of
 * the primary display and kept above other applications, because the point is to
 * be readable while the user is looking at whatever they were already doing. It
 * never takes focus and never accepts a click — it is a read-out, not a control.
 *
 * Collapsed it is a small dark pill with the waveform in it. Expanded it carries
 * the transcript and what the agent is doing about it. Both states are drawn in
 * CSS inside one fixed window rather than by resizing the window itself: a
 * window that resizes per state flickers on Windows and has to be repositioned
 * on every change, and neither is worth it when the window is transparent
 * anyway.
 */

/**
 * This module is imported statically by the bridge wiring, so it is bundled into
 * out/main/index.js and `__dirname` is out/main — one level up from the sibling
 * directories, unlike the dynamically imported pet manager which lands in
 * out/main/chunks. Getting this wrong loads nothing and shows no error, so the
 * paths are resolved once here rather than inline.
 */
const PRELOAD_DIR = path.join(__dirname, '..', 'preload');
const RENDERER_DIR = path.join(__dirname, '..', 'renderer', 'voice');

/**
 * Sized for the widest state it ever reaches, and never resized after.
 *
 * The notch grows and shrinks inside this box in CSS. The window is transparent
 * and ignores the mouse, so the unused area costs nothing — and holding the
 * bounds still means a state change is one repaint rather than a move, a resize
 * and a recentre.
 */
const WIDTH = 680;
const HEIGHT = 280;

let controlWindow: BrowserWindow | null = null;
let ready = false;
let pending: VoiceStageEvent = VOICE_STAGE_OFF;
let hideTimer: NodeJS.Timeout | null = null;
let watchingDisplays = false;

/**
 * Centred on the display and flush to its top edge.
 *
 * `bounds` rather than `workArea` on purpose: the notch is meant to look like
 * part of the hardware, growing out of the edge of the screen. `workArea` would
 * start it below a top-docked taskbar and leave it floating.
 */
const position = (): { x: number; y: number } => {
  const { bounds } = screen.getPrimaryDisplay();
  return {
    x: Math.round(bounds.x + (bounds.width - WIDTH) / 2),
    y: bounds.y,
  };
};

const create = (): BrowserWindow => {
  // Registered on first use, not at import: `screen` is unusable until Electron
  // is ready, and the bridges are wired before that.
  if (!watchingDisplays) {
    watchingDisplays = true;
    screen.on('display-metrics-changed', repositionFoolsControl);
  }

  const { x, y } = position();

  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    // Never steal the keyboard: the user is talking, not typing here.
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(PRELOAD_DIR, 'foolsControlPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 'screen-saver' is the highest ordinary level, so the notch stays visible over
  // full-screen windows as well as over ordinary ones.
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setIgnoreMouseEvents(true);

  window.webContents.once('did-finish-load', () => {
    ready = true;
    window.webContents.send('voice:fools-control', pending);
    // Sent again a moment later: `did-finish-load` can beat the module script's
    // subscription, and a notch that missed the only event it was ever going to
    // get would sit there blank.
    setTimeout(() => {
      if (!window.isDestroyed()) window.webContents.send('voice:fools-control', pending);
    }, 150);
  });

  window.on('closed', () => {
    controlWindow = null;
    ready = false;
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  const file = path.join(RENDERER_DIR, 'foolsControl.html');

  if (!app.isPackaged && devUrl) {
    void window.loadURL(`${devUrl}/voice/foolsControl.html`).catch((error: Error) => {
      console.error("[Fool's Control] dev URL failed, falling back to file:", error.message);
      void window.loadFile(file);
    });
  } else {
    void window.loadFile(file).catch((error: Error) => {
      console.error("[Fool's Control] could not load the window:", error.message);
    });
  }

  return window;
};

const clearHideTimer = (): void => {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
};

/**
 * Whether the user is already looking at the app.
 *
 * The notch exists for talking to the pet across the room with the window
 * minimised or behind something. Thrown over a focused window it covers the very
 * screen the user is reading — and the composer already draws the waveform and
 * the state, so it would be saying it twice.
 */
const appIsInView = (): boolean =>
  BrowserWindow.getAllWindows().some(
    (window) =>
      window !== controlWindow &&
      !window.isDestroyed() &&
      window.isVisible() &&
      !window.isMinimized() &&
      window.isFocused()
  );

/** Shows the notch while voice is live and takes it away shortly after. */
export function updateFoolsControl(event: VoiceStageEvent): void {
  pending = event;

  if (appIsInView()) {
    // Nothing to show over the top of; take away anything already up.
    if (controlWindow) {
      clearHideTimer();
      destroyFoolsControl();
    }
    return;
  }

  if (shouldShowCaption(event)) {
    clearHideTimer();
    controlWindow ??= create();
    if (!controlWindow.isVisible()) controlWindow.showInactive();
    if (ready) controlWindow.webContents.send('voice:fools-control', event);
    return;
  }

  // Not a turn any more — passive listening included: let the last line be read,
  // then take the notch away.
  if (controlWindow && ready) controlWindow.webContents.send('voice:fools-control', event);
  clearHideTimer();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    destroyFoolsControl();
  }, 2600);
}

export function destroyFoolsControl(): void {
  clearHideTimer();
  if (controlWindow && !controlWindow.isDestroyed()) controlWindow.destroy();
  controlWindow = null;
  ready = false;
  pending = VOICE_STAGE_OFF;
}

/** Keeps the notch centred when the display layout changes. */
export function repositionFoolsControl(): void {
  if (!controlWindow || controlWindow.isDestroyed()) return;
  const { x, y } = position();
  controlWindow.setBounds({ x, y, width: WIDTH, height: HEIGHT });
}
