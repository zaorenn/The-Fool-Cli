/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether the words on a button can be read.
 *
 * The palette derives everything from one colour the user picks, which means
 * every pairing in it is a pairing nobody reviewed. Ink on ground was always
 * safe — it is chosen from the measured luminance of the ground. Ink on the
 * *accent* was chosen by a luminance threshold instead, and a threshold cannot
 * express the case where neither black nor white is good enough on its own: on
 * the gold this application ships with, the label on a primary button sat at
 * 2.41:1, against a WCAG AA floor of 4.5.
 *
 * These walk the whole space — every material, both appearances, a spread of
 * accents including the awkward mid-tones — because that is the space a user
 * can actually reach with the colour picker.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCENT,
  READABLE_CONTRAST,
  SURFACE_STYLE_IDS,
  contrastRatio,
  derivePalette,
  readableOn,
} from '@/common/theme/surfaceStyle';

/**
 * Accents chosen to be difficult, not representative.
 *
 * The mid-tones are the ones a threshold gets wrong: light enough that white
 * fails, dark enough that black is marginal.
 */
const ACCENTS = [
  DEFAULT_ACCENT,
  '#c8a24a', // the shipped gold — the pairing that measured 2.41:1
  '#4a7dc8',
  '#e5484d',
  '#4ac87d',
  '#808080',
  '#ffffff',
  '#000000',
];

describe('contrastRatio', () => {
  it('is 21:1 for black on white, the most there is', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('is 1:1 for a colour on itself', () => {
    expect(contrastRatio('#c8a24a', '#c8a24a')).toBeCloseTo(1, 5);
  });

  it('does not care which way round the two are given', () => {
    expect(contrastRatio('#000000', '#c8a24a')).toBeCloseTo(contrastRatio('#c8a24a', '#000000'), 5);
  });
});

describe('readableOn', () => {
  it.each(ACCENTS)('clears the readable threshold on %s', (accent) => {
    expect(contrastRatio(readableOn(accent), accent)).toBeGreaterThanOrEqual(READABLE_CONTRAST);
  });

  it('reaches for white on a dark colour and black on a light one', () => {
    expect(contrastRatio(readableOn('#101014'), '#ffffff')).toBeLessThan(2);
    expect(contrastRatio(readableOn('#f7f8fa'), '#000000')).toBeLessThan(2);
  });

  it('answers the same colour twice for the same background', () => {
    expect(readableOn('#c8a24a')).toBe(readableOn('#c8a24a'));
  });
});

describe('every palette the picker can produce', () => {
  const palettes = SURFACE_STYLE_IDS.flatMap((style) =>
    [false, true].flatMap((dark) =>
      ACCENTS.map((accent) => ({
        label: `${style} ${dark ? 'dark' : 'light'} ${accent}`,
        palette: derivePalette(accent, style, dark),
      }))
    )
  );

  it('covers the whole space rather than a sample of it', () => {
    expect(palettes.length).toBe(SURFACE_STYLE_IDS.length * 2 * ACCENTS.length);
  });

  it('writes readable ink on every ground', () => {
    const failures = palettes
      .filter(({ palette }) => contrastRatio(palette.ink, palette.ground) < READABLE_CONTRAST)
      .map(({ label }) => label);

    expect(failures).toEqual([]);
  });

  it('writes readable ink on every card', () => {
    const failures = palettes
      .filter(({ palette }) => contrastRatio(palette.ink, palette.card) < READABLE_CONTRAST)
      .map(({ label }) => label);

    expect(failures).toEqual([]);
  });

  it('writes a readable label on every accent, which is where it used to fail', () => {
    const failures = palettes
      .filter(({ palette }) => contrastRatio(palette.onAccent, palette.accent) < READABLE_CONTRAST)
      .map(({ label }) => label);

    expect(failures).toEqual([]);
  });
});
