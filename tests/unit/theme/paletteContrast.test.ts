/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { appVariables } from '@/common/theme/appVariables';
import { PALETTES } from '@/common/theme/palettes';
import {
  READABLE_CONTRAST,
  SURFACE_STYLES,
  contrastRatio,
  derivePalette,
  type SurfaceStyleId,
} from '@/common/theme/surfaceStyle';

/**
 * Nine palettes across seven materials in two appearances: every one of the
 * hundred and twenty-six combinations somebody can select, checked.
 *
 * This is the promise the closed list buys. A colour wheel has an unbounded
 * space, so nothing like this could be asserted at all — which is how an
 * interface shipped with a 2.41:1 button label on it, and how "some colours
 * make things invisible" became a thing a user had to report rather than a
 * thing a build refused.
 */
describe('every palette is readable in every material and appearance', () => {
  const materials = Object.keys(SURFACE_STYLES) as SurfaceStyleId[];

  for (const palette of PALETTES) {
    for (const material of materials) {
      for (const dark of [true, false]) {
        it(`${palette.id} on ${material}, ${dark ? 'dark' : 'light'}`, () => {
          const derived = derivePalette(palette.seed, material, dark);
          const written = new Map(appVariables(derived));

          const ink = written.get('--color-text-1');
          const card = written.get('--bg-2');
          const page = written.get('--bg-1');
          expect(ink && card && page).toBeTruthy();

          expect(contrastRatio(ink!, card!), 'body text on a panel').toBeGreaterThanOrEqual(READABLE_CONTRAST);
          expect(contrastRatio(ink!, page!), 'body text on the page').toBeGreaterThanOrEqual(READABLE_CONTRAST);
          expect(contrastRatio(derived.onAccent, derived.accent), 'button label on the accent').toBeGreaterThanOrEqual(
            READABLE_CONTRAST
          );
        });
      }
    }
  }
});
