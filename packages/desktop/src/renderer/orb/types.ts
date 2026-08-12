/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What an orb is, so a different one can be written without touching anything
 * else.
 *
 * The orb replaces the pet while a conversation is running, which means it is
 * drawn in the pet window — a plain HTML entry with no React, no i18n runtime
 * and no access to the app's stylesheets. So everything here is
 * framework-free and takes its colours as values rather than reading them off
 * an element: the same module then works in the pet window, in the main window
 * and in a settings preview without three versions of itself.
 *
 * A skin gets a frame and draws it. It is given no way to keep state between
 * frames on purpose — everything that changes is in {@link OrbFrame}, so two
 * skins cannot disagree about what "speaking" means or how fast time runs, and
 * swapping one for another cannot leave the previous one's state behind.
 */

import type { VoiceStage } from '@/common/types/voiceStage';

/** A colour as three channels, which is what a canvas gradient wants. */
export type Rgb = readonly [number, number, number];

/**
 * The colours for one frame, already resolved.
 *
 * Resolved rather than read: the pet window is told the app's accent over IPC
 * precisely because it cannot see the theme itself, and a skin that reached for
 * a CSS variable would silently draw grey there. Everything a skin needs to
 * match the app arrives in here.
 */
export type OrbPalette = {
  /** The colour of this stage. Follows the accent for speaking. */
  tint: Rgb;
  /** The app's accent, whatever the stage. For anything that is identity. */
  accent: Rgb;
  /** A neutral for structure — ticks, rules, anything not carrying meaning. */
  ink: Rgb;
};

/** Everything a skin is given for one frame. */
export type OrbFrame = {
  ctx: CanvasRenderingContext2D;
  /** CSS pixels. The context is already scaled, so no skin handles DPR. */
  width: number;
  height: number;
  /**
   * Milliseconds since the orb was mounted.
   *
   * Frozen when the user has asked for reduced motion, rather than the skin
   * being asked to check: a skin that forgets the check is a skin that spins
   * for somebody who asked it not to, and that is not a mistake worth leaving
   * to thirty separate authors.
   */
  time: number;
  /** Microphone level, 0..1, eased toward the stage's own energy. */
  level: number;
  stage: VoiceStage;
  palette: OrbPalette;
};

export type OrbSkin = {
  /** Stored in settings, so it must not change once shipped. */
  id: string;
  /** Shown in the picker, in English; the settings page translates it. */
  label: string;
  /** One line about what it looks like, for the same picker. */
  about: string;
  draw: (frame: OrbFrame) => void;
};
