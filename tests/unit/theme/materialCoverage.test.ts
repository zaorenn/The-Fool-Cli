/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { materialTokens } from '@/common/theme/materialStylesheet';
import { PALETTES } from '@/common/theme/palettes';
import { defaultSurfaceChoice } from '@/common/theme/surfaceChoice';

const RENDERER = resolve(__dirname, '../../../packages/desktop/src/renderer');

/**
 * The families the material owns. Radius, spacing, motion and size variables
 * are set elsewhere and are not colours, so they are not its business.
 */
const COLOUR =
  /^--(color-bg|bg|color-text|text|aou|dialog-fill|primary|brand|color-primary|color-brand|fill|color-fill|workspace-btn|color-guid|color-border|border)/;

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
  new Map(materialTokens(defaultSurfaceChoice(), dark).map(([name, value]) => [name, value]));

describe('the material paints what the application reads', () => {
  /**
   * The guarantee. Twenty-four colour variables were read by the renderer and
   * written by nothing — `--color-bg-popup` and the whole `--aou-*` family among
   * them — so those surfaces kept whatever the base stylesheet said while
   * everything around them moved with the material. That is the "some panels
   * never match" report, and it was an omission rather than a conflict.
   *
   * This fails on the day somebody adds a variable nothing paints, rather than
   * months later when a user notices one panel is the wrong colour.
   */
  it('leaves no colour variable unpainted', () => {
    const paints = written(true);
    const unpainted = [...variablesTheAppReads()].filter((name) => !paints.has(name)).sort();

    expect(unpainted, `unpainted colour variables: ${unpainted.join(' ')}`).toEqual([]);
  });

  it('paints them in light as well as dark', () => {
    const paints = written(false);
    const unpainted = [...variablesTheAppReads()].filter((name) => !paints.has(name)).sort();

    expect(unpainted, `unpainted in light: ${unpainted.join(' ')}`).toEqual([]);
  });

  /**
   * The reason light mode was nonsense: the layer that used to outrank this one
   * stored four colours with no idea which appearance was showing, so a ground
   * chosen in the dark kept winning after the switch.
   */
  it('answers to the appearance rather than assuming one', () => {
    const dark = written(true);
    const light = written(false);

    expect(dark.get('--bg-1')).not.toBe(light.get('--bg-1'));
    expect(dark.get('--color-text-1')).not.toBe(light.get('--color-text-1'));
  });

  it('paints every palette, not only the default', () => {
    for (const palette of PALETTES) {
      const paints = new Map(materialTokens({ style: 'glass', accent: palette.seed }, true));
      const unpainted = [...variablesTheAppReads()].filter((name) => !paints.has(name));
      expect(unpainted, `${palette.id} left unpainted: ${unpainted.join(' ')}`).toEqual([]);
    }
  });
});
