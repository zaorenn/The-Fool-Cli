/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  defaultLayoutTokens,
  LAYOUT_TOKEN_KEYS,
  sanitizeLayoutTokens,
  TOKEN_SPECS,
  tokenStylesheet,
  tokenVariables,
  tokensAreDefault,
} from '@/common/config/layoutTokens';

/**
 * The dials behind the look.
 *
 * Every number here ends up inside a CSS custom property, and it arrives from a
 * config store, a file somebody was sent, and a language model. So the interesting
 * assertions are not about what a valid value does — they are about what an
 * invalid one cannot do.
 */

describe('sanitizeLayoutTokens', () => {
  it('keeps a value in range and snaps it to the control’s own step', () => {
    const tokens = sanitizeLayoutTokens({ radius: 7.4, spacing: 1.13 });

    expect(tokens.radius).toBe(7);
    expect(tokens.spacing).toBe(1.15);
  });

  it('pulls a value outside the range back to the edge rather than refusing it', () => {
    expect(sanitizeLayoutTokens({ radius: 9999 }).radius).toBe(TOKEN_SPECS.radius.max);
    expect(sanitizeLayoutTokens({ radius: -40 }).radius).toBe(TOKEN_SPECS.radius.min);
  });

  /**
   * The one that matters. Anything that is not a finite number must become the
   * app's own default, because the alternative is `NaN` or `Infinity` reaching a
   * stylesheet.
   */
  it('never lets anything but a number through', () => {
    for (const junk of [Number.NaN, Number.POSITIVE_INFINITY, 'red; }', null, {}, []]) {
      expect(sanitizeLayoutTokens({ radius: junk }).radius).toBe(TOKEN_SPECS.radius.fallback);
    }
    expect(sanitizeLayoutTokens('corners').radius).toBe(TOKEN_SPECS.radius.fallback);
  });

  it('reads a number written as a string, which is what a slider round-trip gives', () => {
    expect(sanitizeLayoutTokens({ radius: '4' }).radius).toBe(4);
  });

  it('leaves every knob at what the app has always looked like', () => {
    expect(tokensAreDefault(sanitizeLayoutTokens({}))).toBe(true);
    expect(tokensAreDefault(defaultLayoutTokens())).toBe(true);
    expect(tokensAreDefault(sanitizeLayoutTokens({ radius: 0 }))).toBe(false);
  });

  it('offers a usable range for every knob, so no slider is a single point', () => {
    for (const key of LAYOUT_TOKEN_KEYS) {
      expect(TOKEN_SPECS[key].max).toBeGreaterThan(TOKEN_SPECS[key].min);
      expect(TOKEN_SPECS[key].step).toBeGreaterThan(0);
    }
  });
});

describe('tokenVariables', () => {
  const named = (tokens = defaultLayoutTokens()): Record<string, string> =>
    Object.fromEntries(tokenVariables(tokens).map(([name, value]) => [name, value]));

  it('writes a family of corners rather than one, so a chip is not a panel', () => {
    const variables = named(sanitizeLayoutTokens({ radius: 12 }));

    expect(variables['--fool-radius']).toBe('12px');
    expect(variables['--fool-radius-sm']).toBe('6px');
    expect(variables['--fool-radius-lg']).toBe('18px');
  });

  /**
   * Somebody who has taken corners to zero has asked for square. A pill left
   * rounded would read as the setting having failed to reach it.
   */
  it('squares off the pill when corners are taken to zero', () => {
    expect(named(sanitizeLayoutTokens({ radius: 0 }))['--fool-radius-pill']).toBe('0px');
    expect(named(sanitizeLayoutTokens({ radius: 6 }))['--fool-radius-pill']).toBe('999px');
  });

  it('agrees with reduced motion when motion is taken to zero', () => {
    expect(named(sanitizeLayoutTokens({ motionMs: 0 }))['--fool-motion-ease']).toBe('linear');
  });

  it('writes only numbers and units, whatever it was handed', () => {
    const values = tokenVariables(sanitizeLayoutTokens({ radius: 'red; } body { display:none', accent: '1)' })).map(
      ([, value]) => value
    );

    for (const value of values) expect(value).not.toMatch(/[{};]/);
  });
});

describe('tokenStylesheet', () => {
  it('says nothing at all when nothing has been moved', () => {
    expect(tokenStylesheet(defaultLayoutTokens())).toBe('');
  });

  /**
   * Most of the app was written before these existed and says `rounded-12px` in
   * a utility class. A variable nothing reads would be a slider that does
   * nothing, which is worse than no slider.
   */
  it('reaches the shapes the app actually uses when corners are moved', () => {
    const css = tokenStylesheet(sanitizeLayoutTokens({ radius: 2 }));

    expect(css).toContain('.arco-card');
    expect(css).toContain('border-radius: 2px !important');
  });

  it('leaves everything else alone, so it is a setting rather than a theme', () => {
    const css = tokenStylesheet(sanitizeLayoutTokens({ radius: 2 }));

    expect(css).not.toContain('color:');
    expect(css).not.toContain('background');
  });

  it('scales the root font size rather than every element', () => {
    expect(tokenStylesheet(sanitizeLayoutTokens({ textScale: 1.25 }))).toContain(':root { font-size: 20px; }');
  });
});
