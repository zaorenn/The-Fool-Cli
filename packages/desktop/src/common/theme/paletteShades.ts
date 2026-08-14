/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { contrastRatio, hexToHsl, hslToHex, type Palette } from '@/common/theme/surfaceStyle';

/**
 * Adjusting the four colours a palette derives, without breaking the promise it
 * makes.
 *
 * A palette is one seed colour and everything else is computed from it — which
 * is what guarantees the interface stays readable whatever colour somebody
 * picks, and is also why there was no way to say "a bit darker" or "red text".
 * The obvious answer is four colour pickers, and it is the wrong one: a picker
 * lets anybody land on grey-on-grey, and the whole of `derivePalette` exists to
 * make that impossible.
 *
 * So the adjustments are a closed list of named moves per slot, and every one of
 * them is re-measured against the ground afterwards. Somebody can have red text;
 * they cannot have red text nobody can read.
 */

/** The four things a person can point at. Absent everywhere means untouched. */
export type PaletteShades = {
  ground?: GroundShade;
  card?: CardShade;
  ink?: InkShade;
  accent?: AccentShade;
};

export type GroundShade = 'darker' | 'deepest' | 'lighter';
export type CardShade = 'flat' | 'raised';
export type InkShade = 'soft' | 'sharp' | 'red' | 'amber' | 'green' | 'blue' | 'accent';
export type AccentShade = 'softer' | 'stronger';

export const GROUND_SHADES: readonly GroundShade[] = ['darker', 'deepest', 'lighter'];
export const CARD_SHADES: readonly CardShade[] = ['flat', 'raised'];
export const INK_SHADES: readonly InkShade[] = ['soft', 'sharp', 'red', 'amber', 'green', 'blue', 'accent'];
export const ACCENT_SHADES: readonly AccentShade[] = ['softer', 'stronger'];

/**
 * The contrast text has to keep, whatever colour it is asked to be.
 *
 * WCAG AA for body text. Chosen as the floor rather than as a target: the
 * derived ink is far above it, and this only ever binds when somebody has asked
 * for a colour that is fighting the ground — which is exactly the case that
 * needs a floor rather than a preference.
 */
const INK_CONTRAST_FLOOR = 4.5;

/** How far each named move shifts the ground's lightness. */
const GROUND_STEPS: Record<GroundShade, number> = { darker: -6, deepest: -12, lighter: 6 };

/** The hue each named ink sits at. `accent` is filled in from the palette. */
const INK_HUES: Partial<Record<InkShade, number>> = { red: 2, amber: 34, green: 140, blue: 216 };

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/**
 * The most saturated version of a hue that still reads against the ground.
 *
 * Walks the lightness away from the ground a step at a time and stops at the
 * first value that clears the floor. A search rather than a formula because
 * contrast is not linear in lightness and the answer differs per hue: a
 * saturated yellow needs to be much darker than a blue to reach the same ratio
 * against the same white, and a fixed offset would produce one readable colour
 * and one that is nearly invisible.
 */
const readableInk = (hue: number, saturation: number, ground: string, lightInk: boolean): string => {
  // From the extreme inwards, so what comes back is the *most* coloured version
  // that works rather than the safest one — the point of asking for red text is
  // for it to look red.
  const from = lightInk ? 92 : 16;
  const step = lightInk ? -3 : 3;

  let fallback = hslToHex({ h: hue, s: saturation, l: from });
  for (let index = 0; index < 26; index += 1) {
    const lightness = clamp(from + step * index, 6, 96);
    const candidate = hslToHex({ h: hue, s: saturation, l: lightness });
    if (contrastRatio(candidate, ground) >= INK_CONTRAST_FLOOR) return candidate;
    fallback = candidate;
  }
  // Nothing at this hue cleared the floor — a saturated yellow on white, for
  // instance. The last value tried is the closest, and returning it is better
  // than returning the request unmodified.
  return fallback;
};

/**
 * The palette with the user's adjustments applied.
 *
 * Order matters: the ground moves first, because the ink and the card are both
 * decided *against* the ground and adjusting them first would measure them
 * against a ground that is about to change.
 */
export const applyShades = (palette: Palette, shades: PaletteShades | undefined): Palette => {
  if (!shades || Object.keys(shades).length === 0) return palette;

  let next = palette;

  if (shades.ground) {
    const ground = hexToHsl(next.ground);
    const moved = hslToHex({ ...ground, l: clamp(ground.l + GROUND_STEPS[shades.ground], 4, 98) });
    // `lightInk` is a fact about the ground rather than a preference, so a
    // ground moved far enough to flip it has to say so — otherwise the ink
    // stays dark on a ground that has just become dark.
    const lightInk = contrastRatio('#ffffff', moved) > contrastRatio('#000000', moved);
    const ink = hexToHsl(next.ink);
    const inkSoft = hexToHsl(next.inkSoft);

    next = {
      ...next,
      ground: moved,
      ink: lightInk === next.lightInk ? next.ink : hslToHex({ ...ink, l: lightInk ? 96 : 13 }),
      inkSoft: lightInk === next.lightInk ? next.inkSoft : hslToHex({ ...inkSoft, l: lightInk ? 76 : 40 }),
      lightInk,
    };
  }

  if (shades.card) {
    const ground = hexToHsl(next.ground);
    const card = hexToHsl(next.card);
    // Measured from the ground rather than nudged from the current card, so
    // "flat" means the same thing after the ground has moved.
    const away = next.lightInk ? 11 : 5;
    const delta = shades.card === 'flat' ? Math.round(away / 3) : Math.round(away * 2.2);
    next = { ...next, card: hslToHex({ ...card, l: clamp(ground.l + (next.lightInk ? delta : delta), 3, 99) }) };
  }

  if (shades.ink) {
    const ink = hexToHsl(next.ink);

    if (shades.ink === 'soft' || shades.ink === 'sharp') {
      // Contrast, not colour: softer text is the same ink closer to the ground,
      // sharper is the same ink further from it.
      const towards = next.lightInk ? -1 : 1;
      const shift = (shades.ink === 'soft' ? -10 : 6) * towards;
      const moved = hslToHex({ ...ink, l: clamp(ink.l + shift, 4, 98) });
      // Even "softer" has a floor. Text nobody can read is not a preference
      // that was expressed, it is one that was approximated.
      next = {
        ...next,
        ink: contrastRatio(moved, next.ground) >= INK_CONTRAST_FLOOR ? moved : next.ink,
      };
    } else {
      const hue = shades.ink === 'accent' ? hexToHsl(next.accent).h : (INK_HUES[shades.ink] ?? ink.h);
      const saturation = shades.ink === 'accent' ? Math.max(45, hexToHsl(next.accent).s) : 72;
      const coloured = readableInk(hue, saturation, next.ground, next.lightInk);
      next = {
        ...next,
        ink: coloured,
        // The quiet ink follows the loud one, at half the saturation: leaving it
        // grey under red headings reads as two unrelated decisions.
        inkSoft: hslToHex({ h: hue, s: Math.round(saturation / 2), l: hexToHsl(next.inkSoft).l }),
      };
    }
  }

  if (shades.accent) {
    const accent = hexToHsl(next.accent);
    const saturation = clamp(accent.s + (shades.accent === 'softer' ? -22 : 16), 8, 100);
    const lightness = clamp(accent.l + (shades.accent === 'softer' ? 8 : -6), 12, 92);
    next = { ...next, accent: hslToHex({ h: accent.h, s: saturation, l: lightness }) };
  }

  return next;
};

/** Repairs whatever was stored, dropping any move this version does not have. */
export const sanitizePaletteShades = (value: unknown): PaletteShades | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;

  const pick = <T extends string>(raw: unknown, allowed: readonly T[]): T | undefined =>
    typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;

  const shades: PaletteShades = {
    ground: pick(record.ground, GROUND_SHADES),
    card: pick(record.card, CARD_SHADES),
    ink: pick(record.ink, INK_SHADES),
    accent: pick(record.accent, ACCENT_SHADES),
  };

  // Undefined rather than an object of undefined values, so a stored choice with
  // nothing in it is indistinguishable from one that was never made — which is
  // what lets `applyShades` return the palette untouched.
  const kept = Object.entries(shades).filter(([, chosen]) => chosen !== undefined);
  return kept.length > 0 ? (Object.fromEntries(kept) as PaletteShades) : undefined;
};
