/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The accent used as a word, in all hundred and twenty-six combinations.
 *
 * `paletteContrast` checks the ink on the panel, the ink on the page, and the
 * label on the accent. It does not check the accent *as* the label, which is
 * what a selected tab, a link and an active menu row are — and that is the one
 * the user could see. Measured in the running app across the seven materials:
 * between 2.64:1 and 4.24:1 on the voice panel's selected tab, every one of
 * them under the bar.
 */

import { describe, expect, it } from 'vitest';
import { materialTokens } from '@/common/theme/materialStylesheet';
import { PALETTES } from '@/common/theme/palettes';
import { READABLE_CONTRAST, SURFACE_STYLES, contrastRatio, type SurfaceStyleId } from '@/common/theme/surfaceStyle';

describe('the accent can be read where it is written', () => {
  const materials = Object.keys(SURFACE_STYLES) as SurfaceStyleId[];

  for (const palette of PALETTES) {
    for (const material of materials) {
      for (const dark of [true, false]) {
        it(`${palette.id} on ${material}, ${dark ? 'dark' : 'light'}`, () => {
          const written = new Map(materialTokens({ style: material, accent: palette.seed }, dark));

          const accentText = written.get('--fool-accent-text');
          const card = written.get('--bg-2');
          const page = written.get('--bg-1');
          expect(accentText, 'the accent has a readable form to be written with').toBeTruthy();

          expect(contrastRatio(accentText!, card!), 'a selected tab on a panel').toBeGreaterThanOrEqual(
            READABLE_CONTRAST
          );
          expect(contrastRatio(accentText!, page!), 'a link on the page').toBeGreaterThanOrEqual(READABLE_CONTRAST);
        });
      }
    }
  }

  it('leaves an accent that was already readable exactly as it is', () => {
    // The adjustment is a repair, not a style. A palette that already clears the
    // bar must come through untouched, or every colour drifts a little on every
    // release for no reason anybody asked for.
    const materials2 = Object.keys(SURFACE_STYLES) as SurfaceStyleId[];
    let untouched = 0;
    for (const palette of PALETTES) {
      for (const material of materials2) {
        for (const dark of [true, false]) {
          const written = new Map(materialTokens({ style: material, accent: palette.seed }, dark));
          const card = written.get('--bg-2')!;
          if (contrastRatio(palette.seed, card) >= READABLE_CONTRAST) {
            expect(written.get('--fool-accent-text')).toBe(palette.seed);
            untouched += 1;
          }
        }
      }
    }
    // Guards the assertion above against being vacuous.
    expect(untouched).toBeGreaterThan(0);
  });
});
