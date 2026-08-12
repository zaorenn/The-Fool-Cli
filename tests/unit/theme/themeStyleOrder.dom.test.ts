/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which of five `!important` stylesheets wins.
 *
 * A palette, a material, the layout dials and the four colours in the theme
 * customiser all write the same custom properties into `:root`, all marked
 * important, so the cascade decides on source order alone. Each of them used to
 * append itself last on every write, which made the winner whichever setting was
 * touched most recently — and on a cold start the material was always written
 * after the colours, so a colour somebody had picked did not survive a restart.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', () => ({ ipcBridge: { theme: { setActive: { invoke: vi.fn() } } } }));
vi.mock('@/common/config/configService', () => ({ configService: { get: vi.fn(), set: vi.fn() } }));
vi.mock('@renderer/theme/builtinThemes', () => ({ BUILTIN_THEMES: [] }));

import { applyTheme } from '@renderer/utils/theme/applyTheme';
import { applyThemeOverrides, restackThemeStyles } from '@renderer/utils/theme/applyThemeOverrides';
import { applyLayoutTokens } from '@renderer/utils/theme/applyLayoutTokens';
import { defaultLayoutTokens } from '@/common/config/layoutTokens';
import type { Theme } from '@/common/theme/types';

const decorated: Theme = {
  id: 'hello-kitty',
  name: 'Hello Kitty',
  appearance: 'light',
  css: ':root { --color-bg-1: #ffd7e8; }',
  builtin: true,
  created_at: 0,
  updated_at: 0,
};

/** The ids of the appearance stylesheets in the head, in document order. */
const stack = (): string[] =>
  [...document.head.querySelectorAll('style[id]')].map((element) => element.id).filter((id) => id !== '');

/** Stands in for the Material Studio sheet, which lives in a hook. */
const publishMaterial = (): void => {
  const existing = document.getElementById('fool-material') ?? document.createElement('style');
  existing.id = 'fool-material';
  existing.textContent = ':root { --color-bg-1: #101014 !important; }';
  if (!existing.isConnected) document.head.appendChild(existing);
  restackThemeStyles();
};

const positionOf = (id: string): number => stack().indexOf(id);

describe('theme stylesheet order', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('puts the colours the user picked above the material that would otherwise derive them', () => {
    applyThemeOverrides({ colors: { background: '#123456' } });
    publishMaterial();

    expect(positionOf('theme-overrides')).toBeGreaterThan(positionOf('fool-material'));
  });

  it('keeps them there after a material change, which is when they used to be lost', () => {
    applyThemeOverrides({ colors: { background: '#123456' } });
    publishMaterial();
    publishMaterial();

    expect(positionOf('theme-overrides')).toBeGreaterThan(positionOf('fool-material'));
  });

  it('keeps them there after a theme change, which rewrites the preset underneath', () => {
    applyThemeOverrides({ colors: { background: '#123456' } });
    publishMaterial();
    applyTheme(decorated, document);

    expect(positionOf('theme-overrides')).toBeGreaterThan(positionOf('fool-material'));
    expect(positionOf('fool-material')).toBeGreaterThan(positionOf('theme-decoration'));
  });

  it('puts the dials above the material and below the chosen colours', () => {
    applyThemeOverrides({ colors: { background: '#123456' } });
    publishMaterial();
    // A moved dial, so the stylesheet is written rather than left empty.
    applyLayoutTokens({ ...defaultLayoutTokens(), radius: 12 });

    expect(positionOf('fool-layout-tokens')).toBeGreaterThan(positionOf('fool-material'));
    expect(positionOf('theme-overrides')).toBeGreaterThan(positionOf('fool-layout-tokens'));
  });

  it('leaves the safety net last, whatever else was written', () => {
    applyTheme(decorated, document);
    publishMaterial();
    applyThemeOverrides({ colors: { text: '#ffffff' } });

    expect(stack().at(-1)).toBe('theme-safety-net');
  });

  it('restacks even for somebody who never picked a colour', () => {
    applyTheme(decorated, document);
    publishMaterial();
    applyThemeOverrides({ colors: {} });

    expect(document.getElementById('theme-overrides')).toBeNull();
    expect(stack().at(-1)).toBe('theme-safety-net');
    expect(positionOf('fool-material')).toBeGreaterThan(positionOf('theme-decoration'));
  });

  it('ignores stylesheets that are not part of the appearance system', () => {
    const unrelated = document.createElement('style');
    unrelated.id = 'some-component-styles';
    document.head.appendChild(unrelated);

    restackThemeStyles();

    expect(document.getElementById('some-component-styles')).not.toBeNull();
  });
});
