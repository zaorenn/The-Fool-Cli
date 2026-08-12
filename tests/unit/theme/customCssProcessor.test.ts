/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one function every theme passes through on its way onto the page.
 *
 * It marks each declaration `!important` so a theme can outrank the app's own
 * styles. What it must never do is touch anything that is not a declaration:
 * the previous text-matching version rewrote selectors and cut data URIs in
 * half, so most of what the shipped themes declared never reached the browser.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'postcss';
import { describe, expect, it } from 'vitest';
import { addImportantToAll, processCustomCss, validateCss } from '@renderer/utils/theme/customCssProcessor';

const PRESET_DIR = resolve(
  __dirname,
  '../../../packages/desktop/src/renderer/pages/settings/AppearanceSettings/presets'
);

/** Every selector in the stylesheet, in source order. */
const selectorsOf = (css: string): string[] => {
  const found: string[] = [];
  parse(css).walkRules((rule) => found.push(rule.selector));
  return found;
};

describe('addImportantToAll', () => {
  it('marks an ordinary declaration', () => {
    expect(addImportantToAll('.a { color: red; }')).toContain('color: red !important');
  });

  it('leaves a declaration that is already important alone', () => {
    const out = addImportantToAll('.a { color: red !important; }');

    expect(out.match(/!important/g)).toHaveLength(1);
  });

  it('returns an empty string for empty input', () => {
    expect(addImportantToAll('')).toBe('');
    expect(addImportantToAll('   ')).toBe('');
  });

  it('returns unparseable CSS unchanged rather than dropping the theme', () => {
    const broken = '.a { color: red;';

    expect(addImportantToAll(broken)).toBe(broken);
  });

  describe('selectors', () => {
    it('does not rewrite a pseudo-class', () => {
      expect(selectorsOf(addImportantToAll('.btn:hover { color: red; }'))).toEqual(['.btn:hover']);
    });

    it('does not rewrite a pseudo-element', () => {
      expect(selectorsOf(addImportantToAll('.card::after { content: ""; }'))).toEqual(['.card::after']);
    });

    it('does not rewrite a functional pseudo-class', () => {
      expect(selectorsOf(addImportantToAll('.x:not(.y) { color: red; }'))).toEqual(['.x:not(.y)']);
    });

    it('does not rewrite a vendor pseudo-element with a pseudo-class on it', () => {
      const css = '::-webkit-scrollbar-thumb:hover { background: #333; }';

      expect(selectorsOf(addImportantToAll(css))).toEqual(['::-webkit-scrollbar-thumb:hover']);
    });

    it('keeps a selector list intact', () => {
      const css = ":root,\n[data-theme='dark'] { --bg: #000; }";

      expect(selectorsOf(addImportantToAll(css))).toEqual([":root,\n[data-theme='dark']"]);
    });
  });

  describe('values that contain a semicolon', () => {
    it('keeps a data URI whole', () => {
      const css = '.a { background: url(data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=); }';

      expect(addImportantToAll(css)).toContain('url(data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)');
    });

    it('keeps a quoted semicolon inside the quotes', () => {
      expect(addImportantToAll('.a::after { content: "a;b"; }')).toContain('content: "a;b" !important');
    });
  });

  describe('blocks where !important would void the rule', () => {
    it('leaves @keyframes declarations unmarked, so the animation still runs', () => {
      const out = addImportantToAll('@keyframes fade { from { opacity: 0; } to { opacity: 1; } }');

      expect(out).not.toContain('!important');
    });

    it('leaves a prefixed @-webkit-keyframes unmarked too', () => {
      const out = addImportantToAll('@-webkit-keyframes fade { from { opacity: 0; } }');

      expect(out).not.toContain('!important');
    });

    it('leaves @font-face descriptors unmarked, so the font still loads', () => {
      const out = addImportantToAll('@font-face { font-family: X; src: url(x.woff2) format("woff2"); }');

      expect(out).not.toContain('!important');
    });

    it('still marks declarations outside those blocks in the same stylesheet', () => {
      const out = addImportantToAll('@keyframes fade { from { opacity: 0; } }\n.a { color: red; }');

      expect(out).toContain('color: red !important');
    });

    it('marks declarations inside @media, where !important does apply', () => {
      const out = addImportantToAll('@media (min-width: 600px) { .a { color: red; } }');

      expect(out).toContain('color: red !important');
    });
  });

  describe('the presets that ship with the app', () => {
    const presets = [
      'the-fool.css',
      'jarvis.css',
      'hello-kitty.css',
      'retro-windows.css',
      'misaka-mikoto.css',
      'retroma-y2k.css',
      'discourse-horizon.css',
      'glittering-input-field.css',
      'retroma-obsidian-book.css',
    ];

    it.each(presets)('%s keeps every selector it wrote', (name) => {
      const source = readFileSync(resolve(PRESET_DIR, name), 'utf-8');

      expect(selectorsOf(addImportantToAll(source))).toEqual(selectorsOf(source));
    });

    it.each(presets)('%s still parses after processing', (name) => {
      const source = readFileSync(resolve(PRESET_DIR, name), 'utf-8');

      expect(() => parse(addImportantToAll(source))).not.toThrow();
    });
  });
});

describe('processCustomCss', () => {
  it('wraps the processed stylesheet with the explanatory header', () => {
    const out = processCustomCss('.a { color: red; }');

    expect(out).toContain('User Custom Styles');
    expect(out).toContain('color: red !important');
  });

  it('produces nothing at all for an empty stylesheet', () => {
    expect(processCustomCss('')).toBe('');
  });
});

describe('validateCss', () => {
  it('accepts an empty stylesheet', () => {
    expect(validateCss('')).toEqual({ valid: true });
  });

  it('accepts a stylesheet the parser understands', () => {
    expect(validateCss('.a { color: red; }')).toEqual({ valid: true });
  });

  it('reports an unclosed block with the line it started on', () => {
    const result = validateCss('.a {\n  color: red;\n');

    expect(result.valid).toBe(false);
    expect(result.line).toBe(1);
  });

  it('reports a stray closing brace, which brace-counting called valid', () => {
    expect(validateCss('.a { color: red; }}').valid).toBe(false);
  });
});
