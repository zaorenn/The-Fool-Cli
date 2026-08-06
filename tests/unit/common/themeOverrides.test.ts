/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  colorVariableNames,
  colorVariables,
  defaultThemeOverrides,
  isValidHexColor,
  sanitizeThemeOverrides,
  shellBackgroundCss,
  sanitizeThemePalettes,
  normalizePaletteName,
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
  const entries = (key: Parameters<typeof colorVariables>[0], hex: string) =>
    Object.fromEntries(colorVariables(key, hex).map(([cssVar, value]) => [cssVar, value]));

  it('keeps the Arco and UnoCSS primary variables in step', () => {
    const accent = entries('primary', '#c4123f');

    expect(accent['--color-primary']).toBe('#c4123f');
    expect(accent['--primary']).toBe('#c4123f');
    expect(accent['--brand']).toBe('#c4123f');
    expect(accent['--color-brand-fill']).toBe('#c4123f');
  });

  it('derives the light and dark steps a preset also defines', () => {
    const accent = entries('primary', '#c4123f');

    // Lighter than the base, and progressively so.
    expect(accent['--color-primary-light-1']).not.toBe('#c4123f');
    expect(accent['--color-primary-light-3']).not.toBe(accent['--color-primary-light-1']);
    expect(accent['--color-primary-dark-1']).not.toBe('#c4123f');
  });

  it('emits the rgb triples Arco blends hovers from', () => {
    const accent = entries('primary', '#c4123f');

    expect(accent['--primary-rgb']).toBe('196, 18, 63');
    expect(accent['--primary-6']).toBe('196, 18, 63');
  });

  it('moves every surface variable a panel colour is read from', () => {
    const surface = entries('surface', '#101010');

    expect(surface['--color-bg-2']).toBe('#101010');
    expect(surface['--bg-2']).toBe('#101010');
    expect(surface['--dialog-fill-0']).toBe('#101010');
    // A dark surface gets lighter hover states, not darker ones.
    expect(surface['--bg-hover']).not.toBe('#101010');
  });

  it('shades a light theme the other way', () => {
    const dark = entries('surface', '#101010');
    const light = entries('surface', '#fafafa');

    expect(Number.parseInt(dark['--bg-hover'].slice(1, 3), 16)).toBeGreaterThan(0x10);
    expect(Number.parseInt(light['--bg-hover'].slice(1, 3), 16)).toBeLessThan(0xfa);
  });

  it('gives a background its darker window shell', () => {
    const background = entries('background', '#12151a');

    expect(background['--color-bg-1']).toBe('#12151a');
    expect(background['--bg-base']).not.toBe('#12151a');
  });

  it('fades secondary text away from the primary text colour', () => {
    const text = entries('text', '#f5f1e8');

    expect(text['--color-text-1']).toBe('#f5f1e8');
    expect(text['--color-text-2']).not.toBe('#f5f1e8');
    expect(text['--color-text-3']).not.toBe(text['--color-text-2']);
  });

  it('expands a three-digit hex like a six-digit one', () => {
    expect(entries('primary', '#fff')['--color-primary']).toBe('#ffffff');
  });

  it('writes nothing for a colour that is not valid', () => {
    expect(colorVariables('primary', 'red')).toEqual([]);
  });
});

describe('colorVariableNames', () => {
  it('lists every variable a key writes, so clearing an override is complete', () => {
    const names = colorVariableNames('primary');
    const written = colorVariables('primary', '#c4123f').map(([cssVar]) => cssVar);

    expect(names).toEqual(written);
  });
});

describe('shellBackgroundCss', () => {
  it('re-states the rule presets paint with a literal colour', () => {
    const css = shellBackgroundCss('#12151a');

    expect(css).toContain('html, body, #root');
    // Important, because the preset's own rule is.
    expect(css).toMatch(/background-color: #[0-9a-f]{6} !important;/);
  });

  it('is null for an invalid colour', () => {
    expect(shellBackgroundCss('nope')).toBeNull();
  });
});

/**
 * Palettes the user asked to keep, recalled out loud.
 *
 * "Save this one as sea" and "put the sea one back on" only work if the name is
 * matched the way it is said — with whatever spacing and capitals came out of a
 * transcriber. And every value here ends up in a CSS custom property, so what
 * comes back from disk is checked exactly as strictly as the live overrides.
 */
describe('sanitizeThemePalettes', () => {
  it('keeps a palette of valid colours under its normalized name', () => {
    const kept = sanitizeThemePalettes({ '  Deniz  Mavisi ': { primary: '#1F6F8B' } });

    expect(kept).toEqual({ 'deniz mavisi': { primary: '#1f6f8b' } });
  });

  it('drops a colour that is not a colour, and a palette left with none', () => {
    const kept = sanitizeThemePalettes({
      good: { primary: '#112233', background: 'rgb(1,2,3)' },
      empty: { primary: 'darkish blue' },
    });

    expect(kept).toEqual({ good: { primary: '#112233' } });
  });

  it('drops keys the theme does not have, so nothing unknown reaches a variable', () => {
    expect(sanitizeThemePalettes({ x: { primary: '#000000', evil: '#fff' } })).toEqual({
      x: { primary: '#000000' },
    });
  });

  it('has nothing to offer for a shape that is not a record of palettes', () => {
    expect(sanitizeThemePalettes(null)).toEqual({});
    expect(sanitizeThemePalettes('sea')).toEqual({});
    expect(sanitizeThemePalettes({ '   ': { primary: '#000000' } })).toEqual({});
  });

  it('matches a name however it was said', () => {
    expect(normalizePaletteName('  THE  Sea ')).toBe('the sea');
  });
});
