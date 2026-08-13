/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { appVariables } from '@/common/theme/appVariables';
import { derivePalette } from '@/common/theme/surfaceStyle';

const RENDERER = resolve(__dirname, '../../../packages/desktop/src/renderer');

/**
 * The families the theme owns. Layout, motion, spacing and size variables are
 * not colours and are set elsewhere, so they are not this module's business.
 */
const COLOUR =
  /^--(color-bg|bg|color-text|text|aou|dialog-fill|primary|brand|color-primary|color-brand|fill|workspace-btn|color-guid)/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(entry) ? [path] : [];
  });

const variablesTheAppReads = (): Set<string> => {
  const found = new Set<string>();
  for (const file of sourceFiles(RENDERER)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/var\((--[a-z0-9-]+)/g)) {
      if (COLOUR.test(match[1])) found.add(match[1]);
    }
  }
  return found;
};

const written = (dark: boolean): Map<string, string> =>
  new Map(appVariables(derivePalette('#31a074', 'glass', dark)).map(([name, value]) => [name, value]));

describe('appVariables', () => {
  /**
   * The guarantee. Twenty colour variables used to be written by no layer at
   * all — `--color-bg-popup` among them — so a popup could not match the theme
   * whatever anybody chose. This fails on the day somebody adds a variable
   * nothing paints, rather than months later as "that panel looks wrong".
   */
  it('paints every colour variable the application reads', () => {
    const paints = written(true);
    const unpainted = [...variablesTheAppReads()].filter((name) => !paints.has(name)).sort();

    expect(unpainted, `unpainted colour variables: ${unpainted.join(' ')}`).toEqual([]);
  });

  it('produces a usable value for every name it writes', () => {
    for (const [name, value] of written(true)) {
      expect(value, name).toMatch(/^#[0-9a-f]{6}$|^[\d\s.,]+$/i);
    }
  });

  /**
   * The reason light mode was nonsense: the layer that painted these eighty-six
   * files stored one set of colours with no idea which appearance was showing.
   */
  it('follows the appearance rather than assuming dark', () => {
    const dark = written(true);
    const light = written(false);

    expect(dark.get('--bg-1')).not.toBe(light.get('--bg-1'));
    expect(dark.get('--color-text-1')).not.toBe(light.get('--color-text-1'));
  });

  it('separates a card from the page it sits on', () => {
    const paints = written(true);
    expect(paints.get('--bg-2')).not.toBe(paints.get('--bg-1'));
    expect(paints.get('--bg-3')).not.toBe(paints.get('--bg-2'));
  });
});
