/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  defaultSurfaceChoice,
  resolveTokens,
  sanitizeSurfaceChoice,
  surfaceChoiceVariables,
} from '@/common/theme/surfaceChoice';
import { DEFAULT_ACCENT, MATERIAL_SPECS, SURFACE_STYLES } from '@/common/theme/surfaceStyle';

describe('what gets stored', () => {
  it('is three things, and nothing derived', () => {
    const choice = defaultSurfaceChoice();
    expect(Object.keys(choice).sort()).toEqual(['accent', 'style']);
    expect(choice.accent).toBe(DEFAULT_ACCENT);
  });

  /// A palette kept in the store would go stale the first time the recipe that
  /// derives it changes, and nobody would know which of the two was right.
  it('keeps only what was moved, not the material it was moved from', () => {
    const stored = sanitizeSurfaceChoice({
      style: 'glass',
      accent: '#199fd1',
      tokens: { ...SURFACE_STYLES.glass.tokens, lift: 3 },
    });

    expect(stored.tokens).toEqual({ lift: 3 });
  });

  it('drops the tokens entirely when nothing was moved', () => {
    const stored = sanitizeSurfaceChoice({ style: 'clay', accent: '#31a074', tokens: SURFACE_STYLES.clay.tokens });
    expect(stored.tokens).toBeUndefined();
  });

  it('answers with its own when handed something it does not recognise', () => {
    expect(sanitizeSurfaceChoice(null)).toEqual(defaultSurfaceChoice());
    expect(sanitizeSurfaceChoice({ style: 'skeuomorphic', accent: 'rgb(1,2,3)' })).toEqual(defaultSurfaceChoice());
    expect(sanitizeSurfaceChoice('glass')).toEqual(defaultSurfaceChoice());
  });

  /// A model asked to make the interface calmer writes here.
  it('lets nothing but a number through the tokens', () => {
    const stored = sanitizeSurfaceChoice({
      style: 'neu',
      accent: DEFAULT_ACCENT,
      tokens: { depth: '4px; } * { display: none', lift: 'yes' },
    });
    expect(stored.tokens).toBeUndefined();
  });
});

describe('resolving a choice', () => {
  it('starts from the material and lays the moved dials on top', () => {
    const tokens = resolveTokens({ style: 'aurora', accent: DEFAULT_ACCENT, tokens: { lift: 2 } });
    expect(tokens.lift).toBe(2);
    expect(tokens.blur).toBe(SURFACE_STYLES.aurora.tokens.blur);
  });

  it('gives the material untouched when nothing was moved', () => {
    expect(resolveTokens({ style: 'brutal', accent: DEFAULT_ACCENT })).toEqual(SURFACE_STYLES.brutal.tokens);
  });

  it('clamps a dial that was stored out of range', () => {
    const tokens = resolveTokens({ style: 'neu', accent: DEFAULT_ACCENT, tokens: { depth: 900 } });
    expect(tokens.depth).toBe(MATERIAL_SPECS.depth.max);
  });
});

describe('what reaches the page', () => {
  it('carries the material, the accent and every dial', () => {
    const written = new Map(surfaceChoiceVariables({ style: 'liquid', accent: '#8f5fdb' }, false));
    expect(written.get('--fool-style')).toBe('liquid');
    expect(written.get('--fool-accent')).toBe('#8f5fdb');
    expect(written.get('--fool-blur')).toBe(`${SURFACE_STYLES.liquid.tokens.blur}px`);
  });

  /// The same choice in a dark room is not the same page: half of what is
  /// derived depends on which way the switch is.
  it('derives a different ground for a dark room', () => {
    const light = new Map(surfaceChoiceVariables({ style: 'neu', accent: DEFAULT_ACCENT }, false));
    const dark = new Map(surfaceChoiceVariables({ style: 'neu', accent: DEFAULT_ACCENT }, true));
    expect(light.get('--fool-ground')).not.toBe(dark.get('--fool-ground'));
    expect(light.get('--fool-ink')).not.toBe(dark.get('--fool-ink'));
  });

  it('ignores the switch for a material that is only ever dark', () => {
    const light = new Map(surfaceChoiceVariables({ style: 'aurora', accent: DEFAULT_ACCENT }, false));
    const dark = new Map(surfaceChoiceVariables({ style: 'aurora', accent: DEFAULT_ACCENT }, true));
    expect(light.get('--fool-ground')).toBe(dark.get('--fool-ground'));
  });
});
