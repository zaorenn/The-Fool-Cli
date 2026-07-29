/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { THE_FOOL_THEME_ID } from '@/common/theme/constants';
import { migrateThemeConfig } from '@/common/theme/migrateThemeConfig';
import { BUILTIN_THEMES } from '@renderer/theme/builtinThemes';
import { DEFAULT_THEME_ID } from '@renderer/pages/settings/AppearanceSettings/presets';

const themeCss = readFileSync(
  resolve(process.cwd(), 'packages/desktop/src/renderer/pages/settings/AppearanceSettings/presets/the-fool.css'),
  'utf8'
);

const prepaintCss = readFileSync(
  resolve(process.cwd(), 'packages/desktop/src/renderer/styles/themes/default-color-scheme.css'),
  'utf8'
);

const requiredTokens: Record<string, string> = {
  '--bg-base': '#0b0d10',
  '--bg-1': '#12151a',
  '--bg-2': '#1a1e24',
  '--primary': '#c4123f',
  '--primary-6': '196, 18, 63',
  '--brand': '#c4123f',
  '--text-primary': '#f5f1e8',
  '--text-secondary': '#c7c1b7',
  '--success': '#45b97c',
  '--warning': '#e3a53f',
};

describe('The Fool builtin theme', () => {
  it('is the first builtin and the default dark appearance', () => {
    expect(THE_FOOL_THEME_ID).toBe('the-fool');
    expect(DEFAULT_THEME_ID).toBe(THE_FOOL_THEME_ID);
    expect(BUILTIN_THEMES[0]?.id).toBe(THE_FOOL_THEME_ID);

    const theme = BUILTIN_THEMES.find(({ id }) => id === THE_FOOL_THEME_ID);
    expect(theme).toMatchObject({
      id: THE_FOOL_THEME_ID,
      name: 'The Fool',
      appearance: 'dark',
      builtin: true,
    });
    expect(theme?.cover).toBeTruthy();
    expect(theme).toHaveProperty('css');
    expect(themeCss).toContain("body[arco-theme='dark']");

    for (const [token, value] of Object.entries(requiredTokens)) {
      expect(themeCss).toContain(`${token}: ${value};`);
    }
  });

  it('selects The Fool only for a genuinely fresh profile', () => {
    expect(migrateThemeConfig({})['theme.activeId']).toBe(THE_FOOL_THEME_ID);
    expect(migrateThemeConfig({ theme: 'light' })['theme.activeId']).toBe('light');
  });

  it('prepaints the dark app shell with the same palette before theme hydration', () => {
    expect(prepaintCss).toContain('The Fool dark prepaint');
    expect(prepaintCss).toContain('--bg-base: #0b0d10;');
    expect(prepaintCss).toContain('--primary: #c4123f;');
    expect(prepaintCss).toContain('--text-primary: #f5f1e8;');
    expect(prepaintCss).toContain('--border-base: #303741;');
  });
});
