/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  clampRadius,
  colorVariables,
  defaultThemeOverrides,
  isValidHexColor,
  radiusVariables,
  sanitizeThemeOverrides,
} from '@/common/config/themeOverrides';

describe('isValidHexColor', () => {
  it.each(['#fff', '#FFFFFF', '#c4123f', '#c4123f80'])('accepts %s', (value) => {
    expect(isValidHexColor(value)).toBe(true);
  });

  it.each(['red', '#ff', 'c4123f', '#gggggg', 'var(--x)', 'url(evil)', ''])('rejects %s', (value) => {
    expect(isValidHexColor(value)).toBe(false);
  });
});

describe('clampRadius', () => {
  it.each([
    [8, 8],
    [-5, 0],
    [99, 24],
    [7.6, 8],
  ])('maps %i to %i', (input, expected) => {
    expect(clampRadius(input)).toBe(expected);
  });

  it('falls back to the default for non-finite input', () => {
    expect(clampRadius(Number.NaN)).toBe(defaultThemeOverrides().radiusPx);
  });
});

describe('sanitizeThemeOverrides', () => {
  it('keeps valid colours and normalises their case', () => {
    expect(sanitizeThemeOverrides({ colors: { primary: '#C4123F' }, radiusPx: 12 })).toEqual({
      colors: { primary: '#c4123f' },
      radiusPx: 12,
    });
  });

  it('drops a colour that is not a hex value, so stored data cannot inject CSS', () => {
    const result = sanitizeThemeOverrides({ colors: { primary: 'red; background: url(evil)' }, radiusPx: 8 });

    expect(result.colors.primary).toBeUndefined();
  });

  it('drops unknown colour keys', () => {
    const result = sanitizeThemeOverrides({ colors: { nope: '#fff' }, radiusPx: 8 });

    expect(result.colors).toEqual({});
  });

  it('returns defaults for a non-object', () => {
    expect(sanitizeThemeOverrides(null)).toEqual(defaultThemeOverrides());
    expect(sanitizeThemeOverrides('#fff')).toEqual(defaultThemeOverrides());
  });

  it('clamps an out-of-range radius rather than rejecting the whole object', () => {
    expect(sanitizeThemeOverrides({ colors: {}, radiusPx: 1000 }).radiusPx).toBe(24);
  });
});

describe('colorVariables', () => {
  it('keeps the Arco and UnoCSS primary variables in step', () => {
    expect(colorVariables('primary', '#c4123f')).toEqual([
      ['--color-primary', '#c4123f'],
      ['--primary', '#c4123f'],
    ]);
  });

  it('emits a single variable when there is nothing to mirror', () => {
    expect(colorVariables('surface', '#101010')).toEqual([['--color-bg-2', '#101010']]);
  });
});

describe('radiusVariables', () => {
  it('scales small and large corners from the chosen radius', () => {
    expect(radiusVariables(8)).toEqual([
      ['--border-radius-small', '2px'],
      ['--border-radius-medium', '8px'],
      ['--border-radius-large', '12px'],
    ]);
  });

  it('produces square corners at zero', () => {
    expect(radiusVariables(0).every(([, value]) => value === '0px')).toBe(true);
  });
});
