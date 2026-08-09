/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The dials, arranged the way somebody looks for one.
 *
 * `surfaceStyle.ts` says what each number is allowed to be; this says where it
 * appears and how it reads back. Kept apart because the ranges are a fact about
 * the material and this is a fact about the panel — the spoken tool moves the
 * same dials and has no groups, no order and no `°`.
 *
 * Seven groups, and every number the material has appears exactly once. Air,
 * text size and speed are not here: they belong to the layout section directly
 * below this one and were built first. The corner is, though — brutal with
 * rounded corners is not brutal, so it had to become part of the material
 * rather than a shape laid over it.
 */

import {
  MATERIAL_SPECS,
  hexToHsl,
  hslToHex,
  type MaterialTokenKey,
  type MaterialSpec,
} from '@/common/theme/surfaceStyle';

/**
 * The three axes of the chosen colour.
 *
 * Not material tokens: they are the one accent, taken apart. A picker answers
 * "which colour", and these answer "not quite that one" — the move somebody
 * makes after the picker, which a picker is bad at.
 */
export const ACCENT_AXES = ['accentHue', 'accentSaturation', 'accentLightness'] as const;

export type AccentAxis = (typeof ACCENT_AXES)[number];

export type DialKey = MaterialTokenKey | AccentAxis;

/**
 * Bounds the accent is edited within.
 *
 * Narrower than the colour space on purpose. Everything is derived from this
 * one value, and a fully desaturated or near-black accent derives an interface
 * with no accent in it — a state a slider should not be able to reach by being
 * dragged to its end.
 */
export const ACCENT_SPECS: Record<AccentAxis, MaterialSpec> = {
  accentHue: { min: 0, max: 359, step: 1, fallback: 358 },
  accentSaturation: { min: 8, max: 100, step: 1, fallback: 74 },
  accentLightness: { min: 25, max: 80, step: 1, fallback: 58 },
};

export const isAccentAxis = (key: DialKey): key is AccentAxis => (ACCENT_AXES as readonly string[]).includes(key);

export const dialSpec = (key: DialKey): MaterialSpec => (isAccentAxis(key) ? ACCENT_SPECS[key] : MATERIAL_SPECS[key]);

/** How a number reads back to the person who moved it. */
export type DialFormat = 'degrees' | 'percent' | 'ratio' | 'pixels' | 'times' | 'number' | 'em' | 'gain';

const FORMATS: Record<DialKey, DialFormat> = {
  accentHue: 'degrees',
  accentSaturation: 'percent',
  accentLightness: 'percent',
  tint: 'ratio',
  radius: 'pixels',
  edge: 'pixels',
  depth: 'number',
  spread: 'times',
  inner: 'ratio',
  blur: 'pixels',
  alpha: 'ratio',
  saturation: 'gain',
  sheen: 'ratio',
  weight: 'number',
  tracking: 'em',
  leading: 'times',
  gap: 'ratio',
  bounce: 'ratio',
  lift: 'pixels',
  press: 'pixels',
  ambient: 'ratio',
};

/**
 * The value as it is shown, which is not always how it is stored.
 *
 * A ratio is stored as `0.85` and read as `85%`, because nobody has ever asked
 * for a surface to be zero point eight five see-through.
 */
export const formatDial = (key: DialKey, value: number): string => {
  switch (FORMATS[key]) {
    case 'degrees':
      return `${Math.round(value)}°`;
    case 'percent':
      return `${Math.round(value)}%`;
    case 'ratio':
      return `${Math.round(value * 100)}%`;
    case 'pixels':
      return `${value}px`;
    case 'times':
      return `${value}×`;
    case 'em':
      return `${value.toFixed(3)}em`;
    case 'gain':
      return `+${value}%`;
    default:
      return String(value);
  }
};

export type DialGroup = {
  /** Names the i18n key for the group's heading, and the panel's open state. */
  id: 'colour' | 'form' | 'depth' | 'glass' | 'type' | 'space' | 'motion';
  dials: readonly DialKey[];
};

/**
 * Ordered by how often somebody reaches for one.
 *
 * Colour first because it is the only thing most people will ever change, and
 * motion last because it is the one that is set once and then left alone.
 */
export const DIAL_GROUPS: readonly DialGroup[] = [
  { id: 'colour', dials: ['accentHue', 'accentSaturation', 'accentLightness', 'tint'] },
  { id: 'form', dials: ['radius', 'edge'] },
  { id: 'depth', dials: ['depth', 'spread', 'inner'] },
  { id: 'glass', dials: ['blur', 'alpha', 'saturation', 'sheen'] },
  { id: 'type', dials: ['weight', 'tracking', 'leading'] },
  { id: 'space', dials: ['gap'] },
  { id: 'motion', dials: ['bounce', 'lift', 'press', 'ambient'] },
];

/** Where an accent axis currently sits, read out of the colour itself. */
export const accentAxisValue = (accent: string, axis: AccentAxis): number => {
  const hsl = hexToHsl(accent);
  if (axis === 'accentHue') return hsl.h;
  if (axis === 'accentSaturation') return hsl.s;
  return hsl.l;
};

/**
 * The colour that axis moved to.
 *
 * Round-trips through integer HSL, which drifts a step — acceptable here and
 * nowhere else: this is somebody dragging until it looks right, so the value
 * they end on is the one they saw, whatever it was called on the way.
 */
export const accentWithAxis = (accent: string, axis: AccentAxis, value: number): string => {
  const hsl = hexToHsl(accent);
  if (axis === 'accentHue') return hslToHex({ ...hsl, h: value });
  if (axis === 'accentSaturation') return hslToHex({ ...hsl, s: value });
  return hslToHex({ ...hsl, l: value });
};
