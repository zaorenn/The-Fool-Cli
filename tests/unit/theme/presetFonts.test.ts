/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fonts a skin is not allowed to ask for first.
 *
 * Meiryo, Yu Gothic and Hiragino draw U+005C as a yen sign rather than a
 * backslash. Put one at the head of a stack and every Windows path in the app
 * reads `C:¥Users¥…`, and every escape sequence in a code block goes with it.
 * It is a legitimate face to fall back to; it is never the right first choice
 * for an application that shows paths.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'postcss';
import { describe, expect, it } from 'vitest';

const PRESET_DIR = resolve(
  __dirname,
  '../../../packages/desktop/src/renderer/pages/settings/AppearanceSettings/presets'
);

/** Faces that render a backslash as ¥. */
const YEN_FOR_BACKSLASH = /^(meiryo|yu gothic( ui)?|ms (p)?gothic|hiragino kaku gothic( pron)?)$/i;

const presetFiles = readdirSync(PRESET_DIR).filter((name) => name.endsWith('.css'));

/** The first family named by every `font-family` declaration in the stylesheet. */
const leadingFamilies = (css: string): string[] => {
  const leaders: string[] = [];
  parse(css).walkDecls('font-family', (declaration) => {
    const first = declaration.value
      .split(',')[0]
      ?.trim()
      .replace(/^['"]|['"]$/g, '');
    if (first) leaders.push(first);
  });
  return leaders;
};

describe('preset font stacks', () => {
  it('finds the presets to check', () => {
    expect(presetFiles.length).toBeGreaterThan(0);
  });

  it.each(presetFiles)('%s never leads with a face that draws ¥ for a backslash', (name) => {
    const offenders = leadingFamilies(readFileSync(resolve(PRESET_DIR, name), 'utf-8')).filter((family) =>
      YEN_FOR_BACKSLASH.test(family)
    );

    expect(offenders).toEqual([]);
  });

  it('recognises the face that caused this, so the check is not vacuous', () => {
    expect(leadingFamilies("body { font-family: 'Meiryo', sans-serif; }").some((f) => YEN_FOR_BACKSLASH.test(f))).toBe(
      true
    );
  });
});
