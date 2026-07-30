/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The microphone level while the composer's own button is held down.
 *
 * Deliberately not the voice-stage channel: that one is broadcast over IPC to
 * the pet and the caption strip, and it is what puts the caption window on
 * screen. Holding a button in a window the user is already looking at should not
 * summon a second window over it — but the waveform beside the button still
 * needs a level to draw, so dictation publishes here instead, and it never
 * leaves this renderer.
 *
 * `null` means no dictation is running.
 */

let level: number | null = null;
const listeners = new Set<(level: number | null) => void>();

export const peekDictationLevel = (): number | null => level;

export const publishDictationLevel = (next: number | null): void => {
  if (level === next) return;
  level = next;
  // Snapshot first: a listener may unsubscribe while being notified.
  for (const listener of Array.from(listeners)) listener(next);
};

export const subscribeDictationLevel = (listener: (level: number | null) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
