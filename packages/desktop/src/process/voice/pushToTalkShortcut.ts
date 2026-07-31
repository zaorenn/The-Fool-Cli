/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, globalShortcut } from 'electron';
import { ipcBridge } from '@/common';
import type { VoiceShortcutRequest, VoiceShortcutResponse } from '@/common/types/foolVoice';

/**
 * The desktop-wide shortcut that starts a spoken turn.
 *
 * The whole point of it is to work while the app is not the focused window, which
 * is why it lives here rather than as a key handler in the renderer. Pressing it
 * raises an event the voice loop picks up; what happens next is the renderer's
 * business.
 *
 * One limitation, stated plainly: Electron's `globalShortcut` reports the press
 * and not the release. So this cannot be a hold-to-talk key. The turn ends the way
 * every other spoken turn ends — when the speaker stops — or on a second press,
 * which is the deliberate way to say "that's all".
 */

let registered: string | null = null;

/** Electron throws on a malformed accelerator; treat that as a bad request. */
const tryRegister = (accelerator: string, onPress: () => void): VoiceShortcutResponse['reason'] | null => {
  try {
    if (globalShortcut.isRegistered(accelerator)) return 'taken';
    return globalShortcut.register(accelerator, onPress) ? null : 'taken';
  } catch {
    return 'invalid';
  }
};

const release = (): void => {
  if (registered === null) return;
  try {
    globalShortcut.unregister(registered);
  } catch {
    // Already gone, which is the state we wanted.
  }
  registered = null;
};

export const handleVoiceShortcut = (request: VoiceShortcutRequest): VoiceShortcutResponse => {
  const accelerator = request.accelerator.trim();

  // Re-registering the same key would report it as taken by us.
  if (registered === accelerator) return { accelerator, registered: true };

  release();
  if (accelerator.length === 0) return { accelerator, registered: false };

  if (typeof globalShortcut?.register !== 'function') {
    return { accelerator, registered: false, reason: 'unsupported' };
  }

  const reason = tryRegister(accelerator, () => ipcBridge.foolVoice.pushToTalk.emit());
  if (reason) {
    console.warn(`[FoolVoice] push-to-talk shortcut "${accelerator}" not registered: ${reason}`);
    return { accelerator, registered: false, reason };
  }

  registered = accelerator;
  console.info(`[FoolVoice] push-to-talk shortcut registered: ${accelerator}`);
  return { accelerator, registered: true };
};

/** Called on quit; a shortcut left registered outlives the window that wanted it. */
export const disposeVoiceShortcut = (): void => release();

export const currentVoiceShortcut = (): string | null => registered;

// Registered here rather than in the app entry so this module owns its own
// lifecycle. `app.on` is safe before Electron is ready; `globalShortcut` is only
// ever touched inside a handler, which is not.
app.on('will-quit', release);
