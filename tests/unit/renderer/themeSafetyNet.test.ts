/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { findFatalThemeCss, stripFatalThemeCss, THEME_SAFETY_NET_CSS } from '@renderer/utils/theme/themeSafetyNet';

/**
 * A theme that hides the application takes the settings screen with it, so the
 * user cannot undo it from inside the app. These are the rules that stop a
 * stylesheet reaching that state.
 */
describe('findFatalThemeCss', () => {
  it('passes an ordinary colour theme', () => {
    const css = ':root { --color-primary: #1d9e75; }\n.sidebar { background: #101014; }';

    expect(findFatalThemeCss(css)).toEqual([]);
  });

  it('passes an empty stylesheet', () => {
    expect(findFatalThemeCss('')).toEqual([]);
    expect(findFatalThemeCss('   ')).toEqual([]);
  });

  it.each([
    ['body { display: none; }', 'display'],
    ['html { display:none }', 'display'],
    ['* { display: none }', 'display'],
    ['#root { visibility: hidden; }', 'visibility'],
    ['body { opacity: 0; }', 'opacity'],
    ['body { opacity: 0.0 }', 'opacity'],
    ['html { transform: scale(0); }', 'transform'],
  ])('catches %s', (css, property) => {
    const found = findFatalThemeCss(css);

    expect(found.length).toBeGreaterThan(0);
    expect(found.join(' ')).toContain(property);
  });

  it('catches a rule that hides the app whatever the whitespace and casing', () => {
    expect(findFatalThemeCss('BODY{DISPLAY:NONE}')).not.toEqual([]);
    expect(findFatalThemeCss('body\n{\n  display :   none ;\n}')).not.toEqual([]);
  });

  /**
   * Hiding one component is the user's business. Only rules that reach the
   * whole application are refused, so themes stay expressive.
   */
  it('allows hiding an individual element', () => {
    expect(findFatalThemeCss('.some-badge { display: none; }')).toEqual([]);
    expect(findFatalThemeCss('.tooltip { opacity: 0; }')).toEqual([]);
  });

  it('allows a zero opacity that is part of an animation rather than a resting state', () => {
    expect(findFatalThemeCss('@keyframes fade { from { opacity: 0; } to { opacity: 1; } }')).toEqual([]);
  });

  it('reports every offending rule, not only the first', () => {
    const found = findFatalThemeCss('body { display: none } html { opacity: 0 }');

    expect(found.length).toBe(2);
  });
});

/**
 * The net pins `html`, `body` and `#root`, which answers a rule aimed at those.
 * A universal selector hides everything *inside* them instead, leaving the
 * protected elements visible and empty — no selector can undo that, so the
 * declaration is removed rather than outranked.
 */
describe('stripFatalThemeCss', () => {
  it('removes a universal rule that would empty the window', () => {
    const stripped = stripFatalThemeCss('* { display: none; }');

    expect(stripped).not.toMatch(/display\s*:\s*none/i);
  });

  it('keeps the rest of an offending rule', () => {
    const stripped = stripFatalThemeCss('body { display: none; background: #101014; }');

    expect(stripped).not.toMatch(/display\s*:\s*none/i);
    expect(stripped).toContain('background');
    expect(stripped).toContain('#101014');
  });

  it('leaves an ordinary theme byte-for-byte alone', () => {
    const css = ':root { --color-primary: #1d9e75; }\n.sidebar { background: #101014; }';

    expect(stripFatalThemeCss(css)).toBe(css);
  });

  it('leaves a component hiding itself alone', () => {
    const css = '.some-badge { display: none; }';

    expect(stripFatalThemeCss(css)).toBe(css);
  });

  it('survives an empty stylesheet', () => {
    expect(stripFatalThemeCss('')).toBe('');
  });

  it('strips every offending selector in a list', () => {
    const stripped = stripFatalThemeCss('html, body { opacity: 0; }');

    expect(stripped).not.toMatch(/opacity\s*:\s*0/);
  });
});

describe('THEME_SAFETY_NET_CSS', () => {
  /**
   * The last word on whether the window can be seen. Custom CSS is injected
   * with `!important` on every declaration, so the net has to carry it too or
   * it would lose to the very rules it exists to survive.
   */
  it('forces the app-level elements back into view', () => {
    for (const selector of ['html', 'body']) {
      expect(THEME_SAFETY_NET_CSS).toContain(selector);
    }
    expect(THEME_SAFETY_NET_CSS).toMatch(/display:\s*block\s*!important/);
    expect(THEME_SAFETY_NET_CSS).toMatch(/visibility:\s*visible\s*!important/);
    expect(THEME_SAFETY_NET_CSS).toMatch(/opacity:\s*1\s*!important/);
  });
});
