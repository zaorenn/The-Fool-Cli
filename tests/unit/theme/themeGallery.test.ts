/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the theme gallery shows, and what it falls back to.
 *
 * Every card is a promise about what happens when it is clicked, and each of
 * these guards a way that promise was being broken: a preview drawn from the
 * wrong appearance, a palette the preview parser could not see, a theme file
 * shipped with no way to reach it, and a delete that landed on a theme nobody
 * had chosen.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveActiveTheme } from '@/common/theme/resolveTheme';
import {
  extractThemePreviewPalette,
  inferAppearance,
} from '@renderer/pages/settings/AppearanceSettings/CssThemeSettings';
import { DEFAULT_THEME_ID, LIGHT_THEME_ID, SYSTEM_THEME_ID, DARK_THEME_ID } from '@/common/theme/constants';
import type { Theme } from '@/common/theme/types';

const PRESET_DIR = resolve(
  __dirname,
  '../../../packages/desktop/src/renderer/pages/settings/AppearanceSettings/presets'
);

const theme = (id: string, appearance: Theme['appearance'] = 'light'): Theme => ({
  id,
  name: id,
  appearance,
  builtin: true,
  created_at: 0,
  updated_at: 0,
});

describe('resolveActiveTheme', () => {
  const themes = [theme(DEFAULT_THEME_ID, 'dark'), theme(LIGHT_THEME_ID), theme(DARK_THEME_ID, 'dark')];

  it('returns the theme that was asked for', () => {
    expect(resolveActiveTheme(LIGHT_THEME_ID, themes).id).toBe(LIGHT_THEME_ID);
  });

  it('resolves the system sentinel by what the OS prefers', () => {
    expect(resolveActiveTheme(SYSTEM_THEME_ID, themes, true).id).toBe(DARK_THEME_ID);
    expect(resolveActiveTheme(SYSTEM_THEME_ID, themes, false).id).toBe(LIGHT_THEME_ID);
  });

  it('falls back to the app default, not to Light, when the id names nothing', () => {
    expect(resolveActiveTheme('a-theme-deleted-in-another-window', themes).id).toBe(DEFAULT_THEME_ID);
  });

  it('still answers when even the default is missing', () => {
    expect(resolveActiveTheme('nothing', [theme(LIGHT_THEME_ID)]).id).toBe(LIGHT_THEME_ID);
  });
});

describe('the presets on disk', () => {
  it('are all imported by the builtin registry', () => {
    // Read as text rather than imported: `?raw` is a bundler feature, and the
    // question here is which files the registry names, not what they contain.
    // Four finished themes sat in this folder with nothing importing them, which
    // is invisible from every direction except this one.
    const registry = readFileSync(resolve(PRESET_DIR, '../../../../theme/builtinThemes.ts'), 'utf-8');
    const onDisk = readdirSync(PRESET_DIR).filter((name) => name.endsWith('.css'));

    const unreachable = onDisk.filter((name) => !registry.includes(`presets/${name}?raw`));

    expect({ unreachable }).toEqual({ unreachable: [] });
  });

  it('is looking at a real folder with presets in it', () => {
    expect(readdirSync(PRESET_DIR).filter((name) => name.endsWith('.css')).length).toBeGreaterThan(5);
  });
});

describe('extractThemePreviewPalette', () => {
  /** How The Fool and JARVIS open: a selector list, which the old parser never matched. */
  const selectorList = `:root,\n[data-theme='dark'],\nbody[arco-theme='dark'] {\n  --color-bg-1: #12151a;\n  --color-primary: #c8a24a;\n}`;

  it('reads a palette declared through a selector list', () => {
    const palette = extractThemePreviewPalette(selectorList, 'dark');

    expect(palette.appBg).toBe('#12151a');
    expect(palette.accent).toBe('#c8a24a');
  });

  it('does not silently hand back the generic fallback for those themes', () => {
    const fallback = extractThemePreviewPalette('', 'dark');

    expect(extractThemePreviewPalette(selectorList, 'dark').appBg).not.toBe(fallback.appBg);
  });

  it('prefers the dark block when previewing a dark theme', () => {
    const css = `:root { --color-bg-1: #ffffff; }\n[data-theme='dark'] { --color-bg-1: #101014; }`;

    expect(extractThemePreviewPalette(css, 'dark').appBg).toBe('#101014');
    expect(extractThemePreviewPalette(css, 'light').appBg).toBe('#ffffff');
  });

  it('falls back rather than throwing on a stylesheet that does not parse', () => {
    expect(() => extractThemePreviewPalette('.a { color: red;', 'light')).not.toThrow();
  });

  it('ignores a variable declared for some unrelated component', () => {
    const css = '.sidebar { --color-bg-1: #ff0000; }';

    expect(extractThemePreviewPalette(css, 'light').appBg).toBe(extractThemePreviewPalette('', 'light').appBg);
  });
});

describe('inferAppearance', () => {
  it('calls a dark ground dark', () => {
    expect(inferAppearance(':root { --color-bg-1: #12151a; }')).toBe('dark');
  });

  it('calls a light ground light', () => {
    expect(inferAppearance(':root { --color-bg-1: #f7f8fa; }')).toBe('light');
  });

  it('measures a three-digit hex rather than mistaking it for the default accent', () => {
    expect(inferAppearance(':root { --color-bg-1: #111; }')).toBe('dark');
    expect(inferAppearance(':root { --color-bg-1: #eee; }')).toBe('light');
  });

  it('reads the dark block when that is where the ground is declared', () => {
    expect(inferAppearance("[data-theme='dark'] { --color-bg-1: #0e0e0e; }")).toBe('dark');
  });

  it('answers light for a stylesheet that never says what its ground is', () => {
    expect(inferAppearance('.button { color: red; }')).toBe('light');
    expect(inferAppearance('')).toBe('light');
  });

  it('answers light rather than guessing at a value it cannot measure', () => {
    expect(inferAppearance(':root { --color-bg-1: linear-gradient(#000, #111); }')).toBe('light');
  });
});
