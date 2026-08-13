/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { ACCENT_AXES, offeredDials } from '@renderer/pages/settings/AppearanceSettings/MaterialStudio/dials';
import { SURFACE_STYLES, type SurfaceStyleId } from '@/common/theme/surfaceStyle';

const materials = Object.keys(SURFACE_STYLES) as SurfaceStyleId[];

/**
 * The Appearance page used to carry a "Colour" group: hue, vividness,
 * brightness and how far the colour bleeds into the greys.
 *
 * Every one of those could walk a chosen palette out of the contrast it was
 * chosen for, and the point of replacing the colour wheel with a closed list
 * was that all 126 palette, material and appearance combinations are asserted
 * at 4.5:1. A slider able to leave that set hands the guarantee back.
 *
 * Shape is different: no radius, shadow, spacing or duration can make text
 * unreadable, so shape stays adjustable.
 */
describe('offeredDials', () => {
  it('offers no colour dial in any material', () => {
    for (const material of materials) {
      const offered = [...offeredDials(material)];
      const colour = offered.filter((dial) => (ACCENT_AXES as readonly string[]).includes(dial) || dial === 'tint');

      expect(colour, `${material} offers colour dials: ${colour.join(' ')}`).toEqual([]);
    }
  });

  it('still offers the shape dials each material actually has', () => {
    for (const material of materials) {
      const offered = offeredDials(material);
      const expected = SURFACE_STYLES[material].dials.filter((dial) => dial !== 'tint');

      expect([...offered].toSorted()).toEqual([...expected].toSorted());
      if (expected.length > 0) expect(offered.size).toBeGreaterThan(0);
    }
  });
});
