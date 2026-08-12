/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The orb's colours, worked out from the app's accent and nothing else.
 *
 * This is the whole of "it follows the theme". The pet window is sent the
 * app's resolved accent over IPC — the main window is the only one that knows
 * the active theme *and* any colour the user overrode — and everything the orb
 * draws is derived from that one value, so changing the accent in Appearance
 * changes the orb with no second setting to keep in step.
 *
 * The stage tints are rotations of the accent rather than fixed colours, which
 * matters more than it sounds: a fixed green for "listening" clashes with half
 * the palettes somebody might choose, and a green *derived* from their accent
 * never does. What is fixed is the relationship — listening sits a little
 * cooler than the accent, thinking a little warmer, speaking is the accent
 * itself — so the three stay distinguishable whatever the accent is.
 */

import type { VoiceStage } from '@/common/types/voiceStage';
import type { OrbPalette, Rgb } from './types';

/** `#rgb` or `#rrggbb`, however the accent was written. Grey if it is neither. */
export const readHex = (hex: string): Rgb => {
  const text = hex.trim().replace(/^#/, '');
  const full = text.length === 3 ? [...text].map((c) => c + c).join('') : text;
  if (!/^[0-9a-f]{6}$/i.test(full)) return [136, 136, 136];
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
};

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

const toHsl = ([r, g, b]: Rgb): [number, number, number] => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue =
    max === red
      ? ((green - blue) / delta + (green < blue ? 6 : 0)) / 6
      : max === green
        ? ((blue - red) / delta + 2) / 6
        : ((red - green) / delta + 4) / 6;
  return [hue, saturation, lightness];
};

const fromHsl = (hue: number, saturation: number, lightness: number): Rgb => {
  const h = ((hue % 1) + 1) % 1;
  if (saturation === 0) {
    const flat = Math.round(lightness * 255);
    return [flat, flat, flat];
  }
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (offset: number): number => {
    let t = h + offset;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(channel(1 / 3) * 255), Math.round(channel(0) * 255), Math.round(channel(-1 / 3) * 255)];
};

/**
 * How far each stage sits from the accent, as a turn of the colour wheel.
 *
 * Small numbers on purpose. A third of a turn would give three unmistakable
 * colours and three unrelated ones; an eighth keeps them recognisably the same
 * family, which is what makes the orb look like part of the app rather than a
 * traffic light bolted onto it.
 */
const TURN: Record<VoiceStage, number> = {
  off: 0,
  listening: 0.13,
  hearing: 0.13,
  processing: -0.1,
  generating: -0.1,
  speaking: 0,
};

/** How saturated each stage is relative to the accent. */
const VIVIDNESS: Record<VoiceStage, number> = {
  off: 0.35,
  listening: 0.85,
  hearing: 1,
  processing: 0.9,
  generating: 0.9,
  speaking: 1,
};

/**
 * The palette for a stage, given the app's accent.
 *
 * Pure, and that is what makes it the only part of the orb worth testing on its
 * own: everything else is pixels, and this is the rule that decides whether the
 * pixels belong to the theme.
 */
export const orbPalette = (accentHex: string, stage: VoiceStage, dark = true): OrbPalette => {
  const accent = readHex(accentHex);
  const [hue, saturation, lightness] = toHsl(accent);

  const tint = fromHsl(
    hue + (TURN[stage] ?? 0),
    clamp(saturation * (VIVIDNESS[stage] ?? 1), 0, 1),
    // Nudged toward the middle so a very dark or very pale accent still glows.
    // An orb is a light source; an accent chosen for text on a page is not.
    clamp(lightness * 0.45 + 0.34, 0.34, 0.72)
  );

  // The neutral leans toward the accent rather than being a pure grey, which is
  // the difference between structure that was chosen and structure that was
  // inherited from a default.
  const ink = fromHsl(hue, clamp(saturation * 0.12, 0, 0.14), dark ? 0.72 : 0.34);

  return { tint, accent, ink };
};
