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

  /**
   * The layer that used to sit here wrote four hand-picked colours over the
   * material, knowing nothing about light or dark — so a ground chosen in the
   * dark kept winning after a switch, and choosing a material visibly failed to
   * move most of the interface. Nothing outranks the material now, and this is
   * the test that says so.
   */
  it('writes no colour layer above the material at all', () => {
    applyThemeOverrides({ colors: { background: '#123456' } });
    publishMaterial();

    expect(positionOf('theme-overrides')).toBe(-1);
    expect(document.getElementById('theme-overrides')).toBeNull();
  });

  it('still has nothing to assert after a material change', () => {
    applyThemeOverrides({ colors: { background: '#123456' } });
    publishMaterial();
    publishMaterial();

    expect(positionOf('theme-overrides')).toBe(-1);
  });

  it('keeps the material above the preset after a theme change rewrites it', () => {
    applyThemeOverrides({ colors: { background: '#123456' } });
    publishMaterial();
    applyTheme(decorated, document);

    expect(positionOf('fool-material')).toBeGreaterThan(positionOf('theme-decoration'));
    expect(positionOf('theme-overrides')).toBe(-1);
  });

  it('puts the dials above the material, which is now the top of the colour stack', () => {
    publishMaterial();
    // A moved dial, so the stylesheet is written rather than left empty.
    applyLayoutTokens({ ...defaultLayoutTokens(), radius: 12 });

    expect(positionOf('fool-layout-tokens')).toBeGreaterThan(positionOf('fool-material'));
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
