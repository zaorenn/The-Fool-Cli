/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_FOOL_VOICE_SETTINGS, loadFoolVoiceSettings, type FoolVoiceSettings } from '@/common/types/foolVoice';
import { getClientBusinessSetting, setClientBusinessSetting } from '@renderer/services/clientBusinessSettings';

/**
 * The persisted voice settings, shared across every surface that needs them.
 *
 * The settings page, the talk button, the read-aloud button and the wake-word
 * listener are unrelated components, but a microphone or speaker chosen in one
 * has to take effect in the others straight away — hence one module-level copy
 * with subscribers rather than a `useState` per component.
 */

const CONFIG_KEY = 'fool.voice';

type Listener = (settings: FoolVoiceSettings) => void;

let cached: FoolVoiceSettings | null = null;
let inFlight: Promise<FoolVoiceSettings> | null = null;
const listeners = new Set<Listener>();

const notify = (settings: FoolVoiceSettings): void => {
  // Snapshot first: a listener that unsubscribes on notification would otherwise
  // mutate the set mid-iteration.
  for (const listener of Array.from(listeners)) listener(settings);
};

/**
 * The settings as last read or written, without waiting for the backend.
 *
 * Callers that cannot be asynchronous (a render pass) use this; it is the
 * defaults until the first read resolves.
 */
export const peekVoiceSettings = (): FoolVoiceSettings => cached ?? DEFAULT_FOOL_VOICE_SETTINGS;

/** Reads once and shares the result; concurrent callers await the same request. */
export const readVoiceSettings = async (): Promise<FoolVoiceSettings> => {
  if (cached) return cached;

  inFlight ??= (async () => {
    let stored: unknown;
    try {
      stored = await getClientBusinessSetting(CONFIG_KEY);
    } catch {
      // An unreachable backend must not leave voice unusable; the defaults are
      // a working configuration.
      stored = undefined;
    }
    // Corrupt or partial stored data is repaired rather than thrown, so one bad
    // write cannot lock the user out of their own voice settings.
    const settings = loadFoolVoiceSettings(stored ?? {});
    cached = settings;
    return settings;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
};

/**
 * Applies settings everywhere, then persists them.
 *
 * The in-memory copy is updated first: a failed write must not roll back what
 * the user can already hear and see.
 */
export const writeVoiceSettings = async (next: FoolVoiceSettings): Promise<void> => {
  cached = next;
  notify(next);
  try {
    await setClientBusinessSetting(CONFIG_KEY, next);
  } catch {
    // Kept in memory for this session; the next successful write persists it.
  }
};

export const subscribeVoiceSettings = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Drops the cache so a test — or a signed-out session — starts clean. */
export const resetVoiceSettingsStore = (): void => {
  cached = null;
  inFlight = null;
  listeners.clear();
};
