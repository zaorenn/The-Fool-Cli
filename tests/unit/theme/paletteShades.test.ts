/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  ACCENT_SHADES,
  applyShades,
  CARD_SHADES,
  GROUND_SHADES,
  INK_SHADES,
  sanitizePaletteShades,
} from '@/common/theme/paletteShades';
import { contrastRatio, derivePalette, hexToHsl, SURFACE_STYLES } from '@/common/theme/surfaceStyle';

/**
 * Adjusting the four colours a palette derives, without breaking its promise.
 *
 * The promise is that the interface stays readable whatever colour somebody
 * picks — which is the whole reason there were no per-colour controls in the
 * first place. So the test that matters is not "did the colour change" but
 * "is it still readable after it did", checked across every material and both
 * appearances rather than on the one combination that was being looked at.
 */

const STYLES = Object.keys(SURFACE_STYLES) as (keyof typeof SURFACE_STYLES)[];
const ACCENTS = ['#c4123f', '#e0a800', '#1f6f8b', '#3d7a3d', '#8f5fdb', '#6b6b70'];

/** Every palette the application can actually be wearing. */
const everyPalette = (): {
  accent: string;
  style: string;
  dark: boolean;
  palette: ReturnType<typeof derivePalette>;
}[] =>
  STYLES.flatMap((style) =>
    ACCENTS.flatMap((accent) =>
      [false, true].map((dark) => ({ accent, style, dark, palette: derivePalette(accent, style, dark) }))
    )
  );

/** WCAG AA for body text, which is what the module holds itself to. */
const FLOOR = 4.5;

describe('applyShades', () => {
  it('leaves a palette alone when nothing was asked for', () => {
    const palette = derivePalette('#c4123f', 'neu', false);

    expect(applyShades(palette, undefined)).toBe(palette);
    expect(applyShades(palette, {})).toBe(palette);
  });

  describe('the ground', () => {
    it('actually gets darker, and darkest is darker still', () => {
      const palette = derivePalette('#1f6f8b', 'neu', false);
      const darker = applyShades(palette, { ground: 'darker' }).ground;
      const deepest = applyShades(palette, { ground: 'deepest' }).ground;

      expect(hexToHsl(darker).l).toBeLessThan(hexToHsl(palette.ground).l);
      expect(hexToHsl(deepest).l).toBeLessThan(hexToHsl(darker).l);
      expect(hexToHsl(applyShades(palette, { ground: 'lighter' }).ground).l).toBeGreaterThan(
        hexToHsl(palette.ground).l
      );
    });

    /**
     * `lightInk` is a fact about the ground, not a preference. A ground moved
     * far enough to flip it has to take the ink with it, or the text stays dark
     * on a ground that has just become dark.
     */
    it('takes the ink with it when the ground flips', () => {
      for (const { palette } of everyPalette()) {
        for (const ground of GROUND_SHADES) {
          const shaded = applyShades(palette, { ground });
          expect(contrastRatio(shaded.ink, shaded.ground)).toBeGreaterThanOrEqual(FLOOR);
        }
      }
    });
  });

  describe('the card', () => {
    it('sits closer to the ground when flattened and further when raised', () => {
      const palette = derivePalette('#c4123f', 'neu', false);
      const ground = hexToHsl(palette.ground).l;

      const flat = Math.abs(hexToHsl(applyShades(palette, { card: 'flat' }).card).l - ground);
      const raised = Math.abs(hexToHsl(applyShades(palette, { card: 'raised' }).card).l - ground);

      expect(flat).toBeLessThan(raised);
    });
  });

  describe('the ink', () => {
    /**
     * The request this whole feature was asked for: "make the text red". It has
     * to actually look red, which a red-tinted near-black does not.
     */
    it('makes red text that is recognisably red', () => {
      const palette = derivePalette('#1f6f8b', 'neu', false);

      const ink = hexToHsl(applyShades(palette, { ink: 'red' }).ink);

      expect(ink.s).toBeGreaterThan(40);
      expect(ink.h < 20 || ink.h > 340).toBe(true);
    });

    /**
     * And the constraint that makes it safe to offer. Somebody can have red
     * text; they cannot have red text nobody can read — on any material, in
     * either appearance, against any accent.
     */
    it('keeps every coloured ink readable on every palette', () => {
      for (const { palette, style, accent, dark } of everyPalette()) {
        for (const ink of INK_SHADES) {
          const shaded = applyShades(palette, { ink });
          const ratio = contrastRatio(shaded.ink, shaded.ground);
          expect(
            ratio,
            `${ink} on ${style} ${accent} ${dark ? 'dark' : 'light'} = ${ratio.toFixed(2)}`
          ).toBeGreaterThanOrEqual(FLOOR);
        }
      }
    });

    it('softens and sharpens without dropping below the floor', () => {
      for (const { palette } of everyPalette()) {
        const soft = applyShades(palette, { ink: 'soft' });
        const sharp = applyShades(palette, { ink: 'sharp' });

        expect(contrastRatio(soft.ink, soft.ground)).toBeGreaterThanOrEqual(FLOOR);
        expect(contrastRatio(sharp.ink, sharp.ground)).toBeGreaterThanOrEqual(FLOOR);
      }
    });

    /** Grey quiet text under red headings reads as two unrelated decisions. */
    it('brings the quiet ink along with the loud one', () => {
      const palette = derivePalette('#1f6f8b', 'neu', false);

      const shaded = applyShades(palette, { ink: 'green' });

      expect(hexToHsl(shaded.inkSoft).h).toBeCloseTo(hexToHsl(shaded.ink).h, -1);
    });
  });

  describe('the accent', () => {
    it('moves the saturation the way the name says', () => {
      const palette = derivePalette('#c4123f', 'neu', false);

      expect(hexToHsl(applyShades(palette, { accent: 'softer' }).accent).s).toBeLessThan(hexToHsl(palette.accent).s);
      expect(hexToHsl(applyShades(palette, { accent: 'stronger' }).accent).s).toBeGreaterThan(
        hexToHsl(palette.accent).s
      );
    });

    it('never produces a colour outside the range a hex can hold', () => {
      for (const { palette } of everyPalette()) {
        for (const accent of ACCENT_SHADES) {
          expect(applyShades(palette, { accent }).accent).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    });
  });

  it('holds up when every slot is moved at once', () => {
    for (const { palette } of everyPalette()) {
      const shaded = applyShades(palette, { ground: 'deepest', card: 'raised', ink: 'red', accent: 'stronger' });

      expect(contrastRatio(shaded.ink, shaded.ground)).toBeGreaterThanOrEqual(FLOOR);
      for (const colour of [shaded.ground, shaded.card, shaded.ink, shaded.accent]) {
        expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});

describe('sanitizePaletteShades', () => {
  it('keeps the moves it knows', () => {
    expect(sanitizePaletteShades({ ground: 'darker', ink: 'red' })).toEqual({ ground: 'darker', ink: 'red' });
  });

  /**
   * This arrives from a config file, from another window and from a model told
   * to make the interface calmer. Anything unrecognised is dropped rather than
   * carried into a lookup that would produce `undefined` and paint nothing.
   */
  it('drops a move this version does not have', () => {
    expect(sanitizePaletteShades({ ground: 'neon', ink: 'red' })).toEqual({ ink: 'red' });
    expect(sanitizePaletteShades({ card: 42 })).toBeUndefined();
  });

  /** Nothing chosen has to be indistinguishable from never having chosen. */
  it('answers with nothing rather than an object full of nothing', () => {
    expect(sanitizePaletteShades({})).toBeUndefined();
    expect(sanitizePaletteShades(null)).toBeUndefined();
    expect(sanitizePaletteShades('darker')).toBeUndefined();
  });

  it('accepts every move it advertises', () => {
    for (const ground of GROUND_SHADES) expect(sanitizePaletteShades({ ground })).toEqual({ ground });
    for (const card of CARD_SHADES) expect(sanitizePaletteShades({ card })).toEqual({ card });
    for (const ink of INK_SHADES) expect(sanitizePaletteShades({ ink })).toEqual({ ink });
    for (const accent of ACCENT_SHADES) expect(sanitizePaletteShades({ accent })).toEqual({ accent });
  });
});
