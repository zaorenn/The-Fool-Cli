/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  colorVariables,
  defaultThemeOverrides,
  isValidHexColor,
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

describe('sanitizeThemeOverrides', () => {
  it('keeps valid colours and normalises their case', () => {
    expect(sanitizeThemeOverrides({ colors: { primary: '#C4123F' } })).toEqual({
      colors: { primary: '#c4123f' },
    });
  });

  it('drops a colour that is not a hex value, so stored data cannot inject CSS', () => {
    const result = sanitizeThemeOverrides({ colors: { primary: 'red; background: url(evil)' } });

    expect(result.colors.primary).toBeUndefined();
  });

  it('drops unknown colour keys', () => {
    const result = sanitizeThemeOverrides({ colors: { nope: '#fff' } });

    expect(result.colors).toEqual({});
  });

  it('returns defaults for a non-object', () => {
    expect(sanitizeThemeOverrides(null)).toEqual(defaultThemeOverrides());
    expect(sanitizeThemeOverrides('#fff')).toEqual(defaultThemeOverrides());
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
