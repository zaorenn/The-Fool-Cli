/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The theme editor telling the user what is wrong with their stylesheet.
 *
 * Both checks existed and neither was wired to anything: `validateCss` had no
 * caller at all, and `findFatalThemeCss` had only tests. A stylesheet that did
 * nothing looked exactly like one that worked, which is the failure these
 * assertions exist to catch — delete either call in the modal and they fail.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    dialog: { showOpen: { invoke: vi.fn() } },
    fs: { getImageBase64: { invoke: vi.fn() } },
  },
}));

vi.mock('@renderer/hooks/context/ThemeContext.tsx', () => ({
  useThemeContext: () => ({ theme: 'light' }),
}));

// CodeMirror brings a full editor and a DOM measurement layer that jsdom cannot
// satisfy; the editor is not what these tests are about.
vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value }: { value: string }) => <textarea readOnly value={value} />,
}));

import CssThemeModal from '@renderer/pages/settings/AppearanceSettings/CssThemeModal';
import type { Theme } from '@/common/theme/types';

const themeWithCss = (css: string): Theme => ({
  id: 'draft',
  name: 'Draft',
  appearance: 'light',
  css,
  builtin: false,
  created_at: 0,
  updated_at: 0,
});

const renderWith = (css: string) =>
  render(<CssThemeModal visible theme={themeWithCss(css)} onClose={() => {}} onSave={() => {}} />);

describe('CssThemeModal diagnostics', () => {
  it('says nothing about a stylesheet that parses and hides nothing', () => {
    renderWith('.btn:hover { color: red; }');

    expect(screen.queryByTestId('css-theme-error')).toBeNull();
    expect(screen.queryByTestId('css-theme-fatal')).toBeNull();
  });

  it('reports a stylesheet the parser cannot read', () => {
    renderWith('.a { color: red;');

    expect(screen.getByTestId('css-theme-error').textContent).toContain('settings.cssTheme.cssError');
  });

  it('warns that a window-hiding rule will be ignored', () => {
    renderWith('body { display: none; }');

    expect(screen.getByTestId('css-theme-fatal').textContent).toContain('would hide the whole window');
  });

  it('does not warn about a rule that hides one of the theme’s own elements', () => {
    renderWith('.some-badge { display: none; }');

    expect(screen.queryByTestId('css-theme-fatal')).toBeNull();
  });

  it('reports the parse error alone when the stylesheet is also unreadable', () => {
    renderWith('body { display: none;');

    expect(screen.getByTestId('css-theme-error')).toBeTruthy();
    expect(screen.queryByTestId('css-theme-fatal')).toBeNull();
  });
});
