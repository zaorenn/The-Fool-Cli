/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCENT,
  MATERIAL_SPECS,
  MATERIAL_TOKEN_KEYS,
  SURFACE_STYLES,
  SURFACE_STYLE_IDS,
  derivePalette,
  effectiveAlpha,
  hexToHsl,
  hslToHex,
  isDark,
  isSurfaceStyleId,
  relativeLuminance,
  sanitizeAccent,
  sanitizeMaterialTokens,
  surfaceVariables,
} from '@/common/theme/surfaceStyle';

describe('the materials', () => {
  it('gives every material every dial', () => {
    for (const id of SURFACE_STYLE_IDS) {
      const style = SURFACE_STYLES[id];
      expect(style.id).toBe(id);
      for (const key of MATERIAL_TOKEN_KEYS) {
        expect(typeof style.tokens[key], `${id}.${key}`).toBe('number');
      }
    }
  });

  /// A style that only changed the shadow would be a setting nobody could feel.
  it('makes each material genuinely different from the others', () => {
    const shapes = SURFACE_STYLE_IDS.map((id) => JSON.stringify(SURFACE_STYLES[id].tokens));
    expect(new Set(shapes).size).toBe(SURFACE_STYLE_IDS.length);
  });

  it('keeps every default inside the range its dial allows', () => {
    for (const id of SURFACE_STYLE_IDS) {
      for (const key of MATERIAL_TOKEN_KEYS) {
        const spec = MATERIAL_SPECS[key];
        const value = SURFACE_STYLES[id].tokens[key];
        expect(value, `${id}.${key}`).toBeGreaterThanOrEqual(spec.min);
        expect(value, `${id}.${key}`).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  it('recognises only the materials it has', () => {
    expect(isSurfaceStyleId('aurora')).toBe(true);
    expect(isSurfaceStyleId('skeuomorphic')).toBe(false);
    expect(isSurfaceStyleId(7)).toBe(false);
  });

  /// Aurora in a light room is a different product, not a lighter version of
  /// the same one.
  it('lets a material insist on being dark', () => {
    expect(isDark('aurora', false)).toBe(true);
    expect(isDark('neu', false)).toBe(false);
    expect(isDark('neu', true)).toBe(true);
  });
});

describe('repairing what was stored', () => {
  /// These values reach a stylesheet and they arrive from a config file, an
  /// imported theme and a model asked to make the interface calmer.
  it('refuses anything that is not a number', () => {
    const tokens = sanitizeMaterialTokens({ depth: '12px; } :root { display: none', blur: null, lift: {} });
    expect(tokens.depth).toBe(MATERIAL_SPECS.depth.fallback);
    expect(tokens.blur).toBe(MATERIAL_SPECS.blur.fallback);
    expect(tokens.lift).toBe(MATERIAL_SPECS.lift.fallback);
  });

  it('takes a number written as a string, which is what a form sends', () => {
    expect(sanitizeMaterialTokens({ depth: '18' }).depth).toBe(18);
  });

  it('pulls an out-of-range value back to the edge rather than dropping it', () => {
    expect(sanitizeMaterialTokens({ depth: 9000 }).depth).toBe(MATERIAL_SPECS.depth.max);
    expect(sanitizeMaterialTokens({ depth: -40 }).depth).toBe(MATERIAL_SPECS.depth.min);
    expect(sanitizeMaterialTokens({ alpha: Number.POSITIVE_INFINITY }).alpha).toBe(MATERIAL_SPECS.alpha.fallback);
  });

  it('starts from the material being worn, so one dial does not reset the rest', () => {
    const aurora = SURFACE_STYLES.aurora.tokens;
    const tokens = sanitizeMaterialTokens({ lift: 3 }, aurora);
    expect(tokens.lift).toBe(3);
    expect(tokens.blur).toBe(aurora.blur);
  });

  it('accepts only a colour it can write, and falls back to its own', () => {
    expect(sanitizeAccent('#3A7BD5')).toBe('#3a7bd5');
    expect(sanitizeAccent('red; } body { display:none')).toBe(DEFAULT_ACCENT);
    expect(sanitizeAccent('#abc')).toBe(DEFAULT_ACCENT);
    expect(sanitizeAccent(null)).toBe(DEFAULT_ACCENT);
  });
});

describe('colour', () => {
  it('survives a round trip through hsl', () => {
    for (const hex of ['#e5484d', '#199fd1', '#31a074', '#4a5568', '#ffffff', '#000000']) {
      const back = hslToHex(hexToHsl(hex));
      // A round trip through integer hsl is not lossless; a channel may move by
      // a step. What matters is that it lands on the same colour, not the same
      // string.
      const drift = Math.abs(relativeLuminance(back) - relativeLuminance(hex));
      expect(drift, hex).toBeLessThan(0.02);
    }
  });

  /// HSL lightness says a saturated yellow and a saturated blue at 50% are
  /// equally bright. Black text is readable on one and invisible on the other.
  it('measures brightness the way contrast is defined, not as lightness', () => {
    const yellow = hslToHex({ h: 55, s: 95, l: 50 });
    const blue = hslToHex({ h: 230, s: 95, l: 50 });
    expect(relativeLuminance(yellow)).toBeGreaterThan(relativeLuminance(blue) * 3);
  });
});

describe('the palette derived from one colour', () => {
  // Which end of the scale, not which literal: the label is a very dark or very
  // light tint of the accent's own hue when that still clears the readability
  // bar, because pure white on navy reads as a sticker rather than as part of
  // the palette. `readableOnAccent.test.ts` holds the contrast floor itself.
  it('puts dark text on a light accent and light text on a dark one', () => {
    const onLight = derivePalette('#f2d024', 'neu', false).onAccent;
    const onDark = derivePalette('#2b3a67', 'neu', false).onAccent;

    expect(relativeLuminance(onLight)).toBeLessThan(0.2);
    expect(relativeLuminance(onDark)).toBeGreaterThan(0.7);
  });

  /// The failure this exists to prevent: text the colour of the thing behind it.
  it('keeps ink and ground far enough apart to read, for every accent and material', () => {
    const accents = ['#e5484d', '#f2d024', '#31a074', '#199fd1', '#8f5fdb', '#111111', '#f5f5f5'];
    for (const accent of accents) {
      for (const id of SURFACE_STYLE_IDS) {
        for (const dark of [false, true]) {
          const palette = derivePalette(accent, id, dark);
          const gap = Math.abs(relativeLuminance(palette.ink) - relativeLuminance(palette.ground));
          expect(gap, `${accent} / ${id} / dark=${dark}`).toBeGreaterThan(0.4);
        }
      }
    }
  });

  it('reads the ink off the ground rather than off the theme switch', () => {
    // Aurora is dark whatever the switch says, so its ink is light in a light room.
    expect(derivePalette('#e5484d', 'aurora', false).lightInk).toBe(true);
    expect(derivePalette('#e5484d', 'minimal', false).lightInk).toBe(false);
  });

  it('lets the accent hue into the greys without letting it take over', () => {
    const coloured = derivePalette('#199fd1', 'clay', false, 2);
    const neutral = derivePalette('#199fd1', 'clay', false, 0);
    expect(hexToHsl(coloured.ground).s).toBeGreaterThan(hexToHsl(neutral.ground).s);
    expect(hexToHsl(neutral.ground).s).toBe(0);
  });
});

describe('the see-through floor', () => {
  /// The dial can be dragged to the end without the interface becoming a place
  /// text goes to die.
  it('will not let glass go clear enough to lose the words', () => {
    expect(effectiveAlpha('glass', 0.05)).toBeGreaterThanOrEqual(0.42);
    expect(effectiveAlpha('liquid', 0)).toBeGreaterThanOrEqual(0.42);
    expect(effectiveAlpha('aurora', 0)).toBeGreaterThanOrEqual(0.42);
  });

  it('leaves the solid materials alone', () => {
    expect(effectiveAlpha('brutal', 0.1)).toBe(0.1);
    expect(effectiveAlpha('neu', 1)).toBe(1);
  });
});

describe('what reaches the stylesheet', () => {
  it('writes every value with the unit its property needs', () => {
    const palette = derivePalette(DEFAULT_ACCENT, 'glass', false);
    const written = new Map(surfaceVariables('glass', SURFACE_STYLES.glass.tokens, palette));

    expect(written.get('--fool-style')).toBe('glass');
    expect(written.get('--fool-blur')).toBe('18px');
    expect(written.get('--fool-tracking')).toMatch(/em$/);
    expect(written.get('--fool-saturation')).toMatch(/%$/);
    expect(written.get('--fool-accent')).toBe(palette.accent);
  });

  it('writes the floored alpha, not the one that was asked for', () => {
    const palette = derivePalette(DEFAULT_ACCENT, 'liquid', false);
    const tokens = sanitizeMaterialTokens({ alpha: 0.4 }, SURFACE_STYLES.liquid.tokens);
    const written = new Map(surfaceVariables('liquid', tokens, palette));
    expect(Number(written.get('--fool-alpha'))).toBeGreaterThanOrEqual(0.42);
  });

  /// Nothing that ends up in a stylesheet may carry anything but a number and
  /// its unit — this is the last gate before the page.
  it('lets nothing through that could close a declaration', () => {
    const palette = derivePalette('#e5484d', 'neu', false);
    const tokens = sanitizeMaterialTokens({ depth: '4px; } * { display:none' }, SURFACE_STYLES.neu.tokens);
    for (const [, value] of surfaceVariables('neu', tokens, palette)) {
      expect(value).not.toMatch(/[;{}]/);
    }
  });
});
