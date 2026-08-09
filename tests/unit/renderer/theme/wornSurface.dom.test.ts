/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The join between a stored material and the page.
 *
 * This is the failure the whole layer had until now, and it is a silent one:
 * the panel wrote a choice, the spoken tool wrote a choice, the store kept it
 * across restarts — and nothing ever put it on the document, so every rule in
 * `materials.css` stayed inert and the application went on drawing exactly what
 * it always drew. No error anywhere; just a settings page whose controls do
 * nothing.
 *
 * Applied during bootstrap rather than by the first component to mount, for the
 * same reason the saved colours are: a material that arrives after the first
 * paint is a flash of the look somebody stopped using.
 */

const stored: Record<string, unknown> = {};

vi.mock('@/common/config/configService', () => ({
  configService: {
    initialize: vi.fn(async () => undefined),
    whenReady: vi.fn(async () => undefined),
    get: vi.fn((key: string) => stored[key]),
    set: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => undefined),
  },
}));

const { applySurfaceChoice, clearSurfaceChoice } = await import('@renderer/hooks/config/useSurfaceStyle');
const { bootstrapRendererConfig } = await import('@renderer/services/bootstrapRenderer');

const root = (): HTMLElement => document.documentElement;

describe('wearing a material', () => {
  beforeEach(() => {
    for (const key of Object.keys(stored)) delete stored[key];
    root().removeAttribute('style');
    root().removeAttribute('data-fool-style');
    root().removeAttribute('data-theme');
    document.head.innerHTML = '';
  });

  it('names the material on the root, which is what the stylesheet selects', () => {
    applySurfaceChoice({ style: 'glass', accent: '#199fd1' });

    expect(root().getAttribute('data-fool-style')).toBe('glass');
  });

  it('publishes the derived palette and every dial', () => {
    applySurfaceChoice({ style: 'liquid', accent: '#8f5fdb' });

    expect(root().style.getPropertyValue('--fool-accent')).toBe('#8f5fdb');
    expect(root().style.getPropertyValue('--fool-blur')).toBe('24px');
    expect(root().style.getPropertyValue('--fool-ink')).not.toBe('');
  });

  it('lays a moved dial over the material it was moved on', () => {
    applySurfaceChoice({ style: 'brutal', accent: '#d9b528', tokens: { depth: 4 } });

    expect(root().style.getPropertyValue('--fool-depth')).toBe('4');
  });

  /// Half of what is derived depends on which way the light/dark switch is.
  it('derives against the room the document says it is in', () => {
    applySurfaceChoice({ style: 'neu', accent: '#31a074' });
    const light = root().style.getPropertyValue('--fool-ground');

    root().setAttribute('data-theme', 'dark');
    applySurfaceChoice({ style: 'neu', accent: '#31a074' });

    expect(root().style.getPropertyValue('--fool-ground')).not.toBe(light);
  });

  it('can be taken off again, leaving the app drawing what it always drew', () => {
    applySurfaceChoice({ style: 'clay', accent: '#e5891a' });
    clearSurfaceChoice();

    expect(root().hasAttribute('data-fool-style')).toBe(false);
    expect(root().style.getPropertyValue('--fool-accent')).toBe('');
  });

  it('previews onto its own element without the rest of the app changing', () => {
    applySurfaceChoice({ style: 'neu', accent: '#e5484d' });
    const panel = document.createElement('div');

    applySurfaceChoice({ style: 'aurora', accent: '#5570e8' }, panel);

    expect(panel.getAttribute('data-fool-style')).toBe('aurora');
    expect(root().getAttribute('data-fool-style')).toBe('neu');
  });
});

describe('bootstrap', () => {
  beforeEach(() => {
    for (const key of Object.keys(stored)) delete stored[key];
    root().removeAttribute('style');
    root().removeAttribute('data-fool-style');
    document.head.innerHTML = '';
  });

  it('wears the stored material before anything has rendered', async () => {
    stored['ui.surfaceStyle'] = { style: 'aurora', accent: '#5570e8' };

    await bootstrapRendererConfig(() => undefined);

    expect(root().getAttribute('data-fool-style')).toBe('aurora');
    expect(root().style.getPropertyValue('--fool-accent')).toBe('#5570e8');
  });

  it("wears the app's own material when nothing has been chosen", async () => {
    await bootstrapRendererConfig(() => undefined);

    expect(root().getAttribute('data-fool-style')).toBe('neu');
  });

  /// A model asked to make the interface calmer writes to this key too.
  it('repairs a stored value rather than putting it in a stylesheet', async () => {
    stored['ui.surfaceStyle'] = { style: 'skeuomorphic', accent: 'url(evil)', tokens: { depth: '}html{display:none' } };

    await bootstrapRendererConfig(() => undefined);

    expect(root().getAttribute('data-fool-style')).toBe('neu');
    expect(root().style.getPropertyValue('--fool-accent')).toBe('#e5484d');
    expect(root().style.getPropertyValue('--fool-depth')).toBe('12');
  });
});
