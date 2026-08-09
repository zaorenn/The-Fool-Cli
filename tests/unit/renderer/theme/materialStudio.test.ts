/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCENT,
  MATERIAL_TOKEN_KEYS,
  hexToHsl,
  paletteRamp,
  type MaterialTokenKey,
} from '@/common/theme/surfaceStyle';
import {
  ACCENT_AXES,
  DIAL_GROUPS,
  accentAxisValue,
  accentWithAxis,
  dialSpec,
  formatDial,
  isAccentAxis,
  type DialKey,
} from '@renderer/pages/settings/AppearanceSettings/MaterialStudio/dials';

/**
 * The panel's arrangement of the dials.
 *
 * Two things are worth a test here and the rest is layout. The first is that
 * every number the material has is reachable, exactly once: a dial left out of
 * the groups is a setting only a spoken sentence can move, and a dial listed
 * twice is two sliders arguing about one value. Neither shows up as an error —
 * they show up as somebody not finding a control they were told exists.
 *
 * The second is the accent, which is edited as three numbers and stored as one
 * colour. That round trip has to move only the axis it was asked to move.
 */

const listed = DIAL_GROUPS.flatMap((group) => group.dials);

describe('the panel offers every dial, once', () => {
  it('covers every material token', () => {
    const material = listed.filter((key): key is MaterialTokenKey => !isAccentAxis(key));
    expect(material.toSorted()).toEqual([...MATERIAL_TOKEN_KEYS].toSorted());
  });

  it('covers all three axes of the colour', () => {
    expect(listed.filter(isAccentAxis).toSorted()).toEqual([...ACCENT_AXES].toSorted());
  });

  it('lists nothing twice', () => {
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('gives every dial a range to move in', () => {
    for (const key of listed) {
      const spec = dialSpec(key);
      expect(spec.max).toBeGreaterThan(spec.min);
      expect(spec.step).toBeGreaterThan(0);
    }
  });
});

describe('what a dial reads back as', () => {
  /// Stored as 0.85, read as 85%: nobody has asked for a surface to be zero
  /// point eight five see-through.
  it('shows a ratio as a percentage', () => {
    expect(formatDial('alpha', 0.85)).toBe('85%');
    expect(formatDial('ambient', 0)).toBe('0%');
  });

  it('keeps the unit a person would say', () => {
    expect(formatDial('accentHue', 358)).toBe('358°');
    expect(formatDial('blur', 18)).toBe('18px');
    expect(formatDial('spread', 1.2)).toBe('1.2×');
    expect(formatDial('tracking', -0.02)).toBe('-0.020em');
    expect(formatDial('saturation', 40)).toBe('+40%');
    expect(formatDial('weight', 700)).toBe('700');
  });

  it('has an answer for every dial it shows', () => {
    for (const key of listed) {
      expect(formatDial(key, dialSpec(key).min)).not.toBe('');
    }
  });
});

describe('the accent, taken apart and put back', () => {
  it('reads its own axes back', () => {
    const hsl = hexToHsl(DEFAULT_ACCENT);
    expect(accentAxisValue(DEFAULT_ACCENT, 'accentHue')).toBe(hsl.h);
    expect(accentAxisValue(DEFAULT_ACCENT, 'accentSaturation')).toBe(hsl.s);
    expect(accentAxisValue(DEFAULT_ACCENT, 'accentLightness')).toBe(hsl.l);
  });

  it('moves the axis it was asked to and leaves the others where they were', () => {
    const moved = accentWithAxis(DEFAULT_ACCENT, 'accentHue', 200);
    const before = hexToHsl(DEFAULT_ACCENT);
    const after = hexToHsl(moved);

    expect(after.h).toBe(200);
    // One step of drift is what an integer HSL round trip costs, and it is the
    // price of a slider that reports what the user is looking at.
    expect(Math.abs(after.s - before.s)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.l - before.l)).toBeLessThanOrEqual(1);
  });
});

describe('the ramp beside the picker', () => {
  it('opens on the colour that was actually chosen', () => {
    expect(paletteRamp('#8f5fdb', 'neu', false)[0]).toBe('#8f5fdb');
  });

  it('shows five bands, and they are not all the same colour', () => {
    const ramp = paletteRamp(DEFAULT_ACCENT, 'glass', false);
    expect(ramp).toHaveLength(5);
    expect(new Set(ramp).size).toBeGreaterThan(3);
  });

  /// The point of showing it: a colour that derives an unreadable page should
  /// look wrong here, before it is worn.
  it('answers differently for a dark room', () => {
    const light = paletteRamp(DEFAULT_ACCENT, 'minimal', false);
    const dark = paletteRamp(DEFAULT_ACCENT, 'minimal', true);
    expect(light.at(-1)).not.toBe(dark.at(-1));
  });
});
