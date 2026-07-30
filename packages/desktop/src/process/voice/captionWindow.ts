/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import { shouldShowCaption, VOICE_STAGE_OFF, type VoiceStageEvent } from '@/common/types/voiceStage';

/**
 * The caption strip: what the pet heard, while it is hearing it.
 *
 * A frameless, transparent, click-through window pinned to the bottom of the
 * primary display and kept above other applications, because the point is to be
 * readable while the user is looking at whatever they were already doing. It
 * never takes focus and never accepts a click — it is a read-out, not a control.
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

/** Wide enough for a spoken sentence at a readable size. */
const WIDTH = 620;
const HEIGHT = 132;
/**
 * A hair above the taskbar, centred on the display.
 *
 * `workArea` already excludes the taskbar, so this is the gap between the strip
 * and it — enough that the card's shadow is not clipped, close enough that the
 * strip clearly belongs to the bottom edge of the screen.
 */
const BOTTOM_MARGIN = 18;

let captionWindow: BrowserWindow | null = null;
let ready = false;
let pending: VoiceStageEvent = VOICE_STAGE_OFF;
let hideTimer: NodeJS.Timeout | null = null;
let watchingDisplays = false;

const position = (): { x: number; y: number } => {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height - HEIGHT - BOTTOM_MARGIN),
  };
};

const create = (): BrowserWindow => {
  // Registered on first use, not at import: `screen` is unusable until Electron
  // is ready, and the bridges are wired before that.
  if (!watchingDisplays) {
    watchingDisplays = true;
    screen.on('display-metrics-changed', repositionCaptionWindow);
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
      preload: path.join(PRELOAD_DIR, 'voiceCaptionPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 'screen-saver' is the highest ordinary level, so the strip stays visible over
  // full-screen windows as well as over ordinary ones.
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setIgnoreMouseEvents(true);

  window.webContents.once('did-finish-load', () => {
    ready = true;
    window.webContents.send('voice:caption', pending);
    // Sent again a moment later: `did-finish-load` can beat the module script's
    // subscription, and a strip that missed the only event it was ever going to
    // get would sit there blank.
    setTimeout(() => {
      if (!window.isDestroyed()) window.webContents.send('voice:caption', pending);
    }, 150);
  });

  window.on('closed', () => {
    captionWindow = null;
    ready = false;
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  const file = path.join(RENDERER_DIR, 'caption.html');

  if (!app.isPackaged && devUrl) {
    void window.loadURL(`${devUrl}/voice/caption.html`).catch((error: Error) => {
      console.error('[VoiceCaption] dev URL failed, falling back to file:', error.message);
      void window.loadFile(file);
    });
  } else {
    void window.loadFile(file).catch((error: Error) => {
      console.error('[VoiceCaption] could not load the caption window:', error.message);
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
 * Shows the strip while voice is live and takes it away shortly after.
 *
 * The delay on the way out is deliberate: a transcript that vanished the instant
 * the turn ended would be unreadable.
 */
export function updateCaption(event: VoiceStageEvent): void {
  pending = event;

  if (shouldShowCaption(event)) {
    clearHideTimer();
    captionWindow ??= create();
    if (!captionWindow.isVisible()) captionWindow.showInactive();
    if (ready) captionWindow.webContents.send('voice:caption', event);
    return;
  }

  // Not a turn any more — passive listening included: let the last line be read,
  // then take the strip away.
  if (captionWindow && ready) captionWindow.webContents.send('voice:caption', event);
  clearHideTimer();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    destroyCaptionWindow();
  }, 2600);
}

export function destroyCaptionWindow(): void {
  clearHideTimer();
  if (captionWindow && !captionWindow.isDestroyed()) captionWindow.destroy();
  captionWindow = null;
  ready = false;
  pending = VOICE_STAGE_OFF;
}

/** Keeps the strip centred when the display layout changes. */
export function repositionCaptionWindow(): void {
  if (!captionWindow || captionWindow.isDestroyed()) return;
  const { x, y } = position();
  captionWindow.setBounds({ x, y, width: WIDTH, height: HEIGHT });
}
