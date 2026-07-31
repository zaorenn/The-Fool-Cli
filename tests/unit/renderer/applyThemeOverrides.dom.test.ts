/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { applyThemeOverrides, reassertThemeOverrides } from '@renderer/utils/theme/applyThemeOverrides';

const overrideStyle = () => document.getElementById('theme-overrides');

/** Stands in for a theme preset, which arrives with `!important` attached. */
const injectPreset = () => {
  const preset = document.createElement('style');
  preset.id = 'theme-decoration';
  preset.textContent = `:root { --color-primary: #c4123f !important; }\nhtml, body { background-color: #0b0d10 !important; }`;
  document.head.appendChild(preset);
  return preset;
};

describe('applyThemeOverrides', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('style');
  });

  it('writes nothing at all when no colour has been chosen', () => {
    applyThemeOverrides({ colors: {} });

    expect(overrideStyle()).toBeNull();
  });

  it('publishes the chosen colour as a stylesheet', () => {
    applyThemeOverrides({ colors: { primary: '#2ad17a' } });

    const css = overrideStyle()?.textContent ?? '';
    expect(css).toContain('--color-primary: #2ad17a !important');
    // The whole accent family moves together.
    expect(css).toContain('--brand: #2ad17a !important');
    expect(css).toMatch(/--primary-6: 42, 209, 122 !important/);
  });

  it('marks every declaration important, because presets do too', () => {
    applyThemeOverrides({ colors: { surface: '#33185c' } });

    const declarations = (overrideStyle()?.textContent ?? '').match(/--[a-z0-9-]+:[^;]+;/g) ?? [];
    expect(declarations.length).toBeGreaterThan(0);
    expect(declarations.every((declaration) => declaration.includes('!important'))).toBe(true);
  });

  it('comes after the theme preset, so equal importance is decided in its favour', () => {
    const preset = injectPreset();

    applyThemeOverrides({ colors: { primary: '#2ad17a' } });

    const styles = Array.from(document.head.querySelectorAll('style'));
    expect(styles.indexOf(overrideStyle() as HTMLStyleElement)).toBeGreaterThan(styles.indexOf(preset));
  });

  it('repaints the window shell, which presets set with a literal colour', () => {
    applyThemeOverrides({ colors: { background: '#241040' } });

    const css = overrideStyle()?.textContent ?? '';
    expect(css).toMatch(/html, body, #root \{ background-color: #[0-9a-f]{6} !important; \}/);
  });

  it('leaves the shell alone when only the accent was changed', () => {
    applyThemeOverrides({ colors: { primary: '#2ad17a' } });

    expect(overrideStyle()?.textContent).not.toContain('html, body, #root');
  });

  it('removes the override entirely when the colours are cleared', () => {
    applyThemeOverrides({ colors: { primary: '#2ad17a' } });
    expect(overrideStyle()).not.toBeNull();

    applyThemeOverrides({ colors: {} });

    expect(overrideStyle()).toBeNull();
  });

  it('re-asserts itself after a theme switch moves the preset to the end', () => {
    applyThemeOverrides({ colors: { primary: '#2ad17a' } });
    const preset = injectPreset();
    // The preset now sits after the override, which would win on source order.
    expect(Array.from(document.head.children).indexOf(preset)).toBeGreaterThan(
      Array.from(document.head.children).indexOf(overrideStyle() as HTMLStyleElement)
    );

    reassertThemeOverrides();

    const styles = Array.from(document.head.querySelectorAll('style'));
    expect(styles.indexOf(overrideStyle() as HTMLStyleElement)).toBeGreaterThan(styles.indexOf(preset));
    expect(overrideStyle()?.textContent).toContain('--color-primary: #2ad17a !important');
  });

  it('ignores a stored colour that is not a valid hex value', () => {
    applyThemeOverrides({ colors: { primary: 'url(evil)' as string } });

    expect(overrideStyle()).toBeNull();
  });
});
