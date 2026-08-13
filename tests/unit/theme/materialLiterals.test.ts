/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A material may not name a colour. It may only mix the palette's.
 *
 * This is the guarantee the contrast tests could not give. They check the ink
 * against `--bg-1` and `--bg-2`, which are the tokens the application's own
 * components read — but `.fool-surface`, the class every panel in the app
 * carries, is painted from `--fool-surface-bg`, and nothing checked that.
 *
 * So glass could say `rgb(255 255 255 / calc(var(--fool-alpha) * 0.62))` and
 * pass every one of the hundred and twenty-six combinations while painting a
 * light grey panel in a dark room and putting near-white ink on it. Measured in
 * the running app before this was fixed: the voice panel's labels at 1.62:1 and
 * its selected tab at 1.26:1. Aurora had the same fault pointing the other way,
 * a near-black pane waiting for the first light palette.
 *
 * The rule is structural rather than numeric, and that is deliberate. A ratio
 * can only be checked for the palettes that exist today; "every colour in a
 * material comes from the palette" holds for every palette anybody adds later,
 * because a mix of palette colours cannot leave the range its endpoints were
 * measured in.
 */

const MATERIALS_CSS = resolve(__dirname, '../../../packages/desktop/src/renderer/styles/materials.css');

/** The declarations that decide what a surface is actually painted with. */
const PAINT_PROPERTIES = ['--fool-surface-bg', '--fool-surface-border', '--fool-pane', '--fool-page-bg'];

/** `#abc`, `#aabbcc`, `rgb(...)`, `rgba(...)`, `hsl(...)`, `hwb(...)`, `oklch(...)`. */
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\(/i;

/**
 * Every `--name: value;` in the file, with its value flattened onto one line.
 *
 * Hand-rolled rather than run through a CSS parser because the thing being
 * asserted is a property of the text somebody writes in this file, and a parser
 * that normalised `color-mix` away would assert something else.
 */
const declarations = (css: string): { property: string; value: string; line: number }[] => {
  const found: { property: string; value: string; line: number }[] = [];
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));

  for (const property of PAINT_PROPERTIES) {
    const pattern = new RegExp(`${property}\\s*:`, 'g');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(withoutComments)) !== null) {
      // Read to the semicolon that ends this declaration, tracking brackets so a
      // `linear-gradient(a, b)` is not cut in half by its own comma.
      let depth = 0;
      let end = match.index + match[0].length;
      while (end < withoutComments.length) {
        const char = withoutComments[end];
        if (char === '(') depth += 1;
        else if (char === ')') depth -= 1;
        else if (char === ';' && depth === 0) break;
        end += 1;
      }
      found.push({
        property,
        value: withoutComments
          .slice(match.index + match[0].length, end)
          .replace(/\s+/g, ' ')
          .trim(),
        line: withoutComments.slice(0, match.index).split('\n').length,
      });
    }
  }
  return found;
};

describe('a material paints with the palette and nothing else', () => {
  const css = readFileSync(MATERIALS_CSS, 'utf8');
  const found = declarations(css);

  it('finds the declarations it is meant to be checking', () => {
    // Guards the parser: a rename that made this file match nothing would
    // otherwise turn the whole suite below into a silent pass.
    expect(found.length).toBeGreaterThanOrEqual(10);
    expect(new Set(found.map((d) => d.property)).size).toBeGreaterThanOrEqual(3);
  });

  for (const { property, value, line } of found) {
    it(`${property} at line ${line} names no colour of its own`, () => {
      // What is left once every palette reference and the one keyword that
      // means "no colour at all" are taken out. Anything that still looks like
      // a colour was written by hand.
      const withoutPalette = value
        .replace(/var\(\s*--[a-z0-9-]+(?:\s*,\s*[^()]*)?\)/gi, ' ')
        .replace(/\btransparent\b/gi, ' ')
        .replace(/\bin oklab\b/gi, ' ')
        .replace(/\bin srgb\b/gi, ' ');

      expect(
        COLOUR_LITERAL.test(withoutPalette),
        `${property} is written with a literal colour: "${value}". ` +
          'A surface has to be a mix of --fool-card, --fool-ink, --fool-ground or --fool-accent, ' +
          'or it cannot follow the palette and the ink is no longer measured against what is painted.'
      ).toBe(false);
    });
  }
});
