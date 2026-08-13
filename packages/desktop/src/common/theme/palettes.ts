/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The colours somebody can choose, as a closed list.
 *
 * A colour wheel lets anybody land on a point that derives an unreadable
 * interface, and a model asked to pick a colour will do exactly that. These
 * nine are the ones `ACCENT_SUGGESTIONS` already promises derive a readable
 * palette in all seven materials, so the promise is kept by construction
 * rather than by asking somebody to look afterwards.
 *
 * Naming: `surfaceStyle.ts` exports a `Palette`, which is the *derived*
 * colours — ground, card, ink. A `ThemePalette` is what the user chose. They
 * are different things and deliberately not merged.
 */

import { ACCENT_SUGGESTIONS, hexToHsl } from '@/common/theme/surfaceStyle';

export type PaletteId = 'ember' | 'amber' | 'wheat' | 'moss' | 'lagoon' | 'indigo' | 'orchid' | 'rose' | 'slate';

export type ThemePalette = {
  id: PaletteId;
  /** The one colour the whole palette is derived from. */
  seed: string;
  /** i18n key under `settings.palette.*`. */
  name: string;
  /** Lower-case words that resolve to this palette, in every language spoken here. */
  keywords: readonly string[];
};

/** In the order `ACCENT_SUGGESTIONS` lists them, which is around the wheel. */
const IDS: readonly PaletteId[] = ['ember', 'amber', 'wheat', 'moss', 'lagoon', 'indigo', 'orchid', 'rose', 'slate'];

const KEYWORDS: Record<PaletteId, readonly string[]> = {
  ember: ['red', 'kırmızı', 'kirmizi', 'crimson', 'ember', 'ateş'],
  amber: ['orange', 'turuncu', 'amber', 'kehribar'],
  wheat: ['yellow', 'sarı', 'sari', 'gold', 'altın', 'buğday'],
  moss: ['green', 'yeşil', 'yesil', 'moss', 'forest', 'orman', 'yosun'],
  lagoon: ['teal', 'cyan', 'turkuaz', 'lagoon', 'aqua', 'lagün'],
  indigo: ['blue', 'mavi', 'indigo', 'çivit'],
  orchid: ['purple', 'mor', 'violet', 'orchid', 'lila', 'orkide'],
  rose: ['pink', 'pembe', 'rose', 'magenta', 'gül'],
  slate: ['grey', 'gray', 'gri', 'slate', 'neutral', 'nötr', 'arduvaz'],
};

export const PALETTES: readonly ThemePalette[] = IDS.map((id, index) => ({
  id,
  seed: ACCENT_SUGGESTIONS[index],
  name: `settings.palette.${id}`,
  keywords: KEYWORDS[id],
}));

/**
 * Never throws: an unrecognised id is somebody's stale configuration or a model
 * guessing, and neither is a reason to fail to draw the application.
 */
export const paletteById = (id: string): ThemePalette => PALETTES.find((palette) => palette.id === id) ?? PALETTES[0];

/**
 * The palette a request is asking for, if it named a colour at all.
 *
 * Matched on whole words, so a sentence that merely contains `gri` inside a
 * longer word is not read as a colour request.
 */
export const paletteForRequest = (text: string): ThemePalette | null => {
  const words = new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .filter(Boolean)
  );

  return PALETTES.find((palette) => palette.keywords.some((keyword) => words.has(keyword))) ?? null;
};

/** Shortest way round the hue circle, so 350° and 10° are twenty degrees apart. */
const hueDistance = (a: number, b: number): number => {
  const gap = Math.abs(a - b) % 360;
  return gap > 180 ? 360 - gap : gap;
};

/**
 * The palette closest to a colour somebody picked by hand.
 *
 * Used once, to carry a stored free-form accent across to the closed list when
 * the picker is removed. A grey has no meaningful hue, so anything desaturated
 * resolves to `slate` rather than to whichever hue survived the rounding.
 */
export const nearestPalette = (hex: string): ThemePalette => {
  const chosen = hexToHsl(hex);
  if (chosen.s < 12) return paletteById('slate');

  return PALETTES.reduce((best, palette) =>
    hueDistance(hexToHsl(palette.seed).h, chosen.h) < hueDistance(hexToHsl(best.seed).h, chosen.h) ? palette : best
  );
};
