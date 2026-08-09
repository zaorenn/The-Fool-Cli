/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { applySurfaceIntent, isDialKey, readSurfaceIntent } from '@/common/theme/surfaceIntent';
import { defaultSurfaceChoice, resolveTokens } from '@/common/theme/surfaceChoice';
import { MATERIAL_SPECS, SURFACE_STYLES } from '@/common/theme/surfaceStyle';

describe('reading what the model sent', () => {
  it('takes a material, a colour and a dial', () => {
    const intent = readSurfaceIntent({ material: 'glass', color: '#199fd1', dial: 'blur', amount: 20 });
    expect(intent).toEqual({ material: 'glass', accent: '#199fd1', dial: 'blur', amount: 20 });
  });

  /// Doing something else instead — the nearest material, the default one — is
  /// how an assistant ends up changing something nobody mentioned.
  it('drops anything it does not recognise rather than guessing', () => {
    const intent = readSurfaceIntent({ material: 'skeuomorphic', dial: 'vibes', color: 'sea blue' });
    expect(intent).toEqual({});
  });

  it('takes a direction when no number was given', () => {
    expect(readSurfaceIntent({ dial: 'depth', direction: 'more' })).toEqual({ dial: 'depth', direction: 'more' });
    expect(readSurfaceIntent({ dial: 'depth', direction: 'sideways' })).toEqual({ dial: 'depth' });
  });

  it('takes a number a model sent as a string, which they do', () => {
    expect(readSurfaceIntent({ dial: 'lift', amount: '9' }).amount).toBe(9);
  });

  it('knows which dials exist', () => {
    expect(isDialKey('ambient')).toBe(true);
    expect(isDialKey('sparkle')).toBe(false);
  });
});

describe('applying it', () => {
  it('wears a material and says so', () => {
    const { choice, changed } = applySurfaceIntent(defaultSurfaceChoice(), { material: 'aurora' });
    expect(choice.style).toBe('aurora');
    expect(changed).toEqual(['material']);
  });

  it('keeps the colour when only the material changes', () => {
    const current = { style: 'neu' as const, accent: '#31a074' };
    expect(applySurfaceIntent(current, { material: 'clay' }).choice.accent).toBe('#31a074');
  });

  /// "Switch to glass and calm it down" is one request, and the dial belongs to
  /// the material being switched to, not the one being left.
  it('moves the dial from the new material, not the old one', () => {
    const current = { style: 'neu' as const, accent: '#e5484d' };
    const { choice } = applySurfaceIntent(current, { material: 'aurora', dial: 'blur', direction: 'less' });
    const range = MATERIAL_SPECS.blur.max - MATERIAL_SPECS.blur.min;
    expect(resolveTokens(choice).blur).toBeCloseTo(SURFACE_STYLES.aurora.tokens.blur - range * 0.1, 5);
  });

  it('nudges by something a person would notice, in the direction asked', () => {
    const base = defaultSurfaceChoice();
    const before = resolveTokens(base).depth;
    const up = resolveTokens(applySurfaceIntent(base, { dial: 'depth', direction: 'more' }).choice).depth;
    const down = resolveTokens(applySurfaceIntent(base, { dial: 'depth', direction: 'less' }).choice).depth;

    expect(up).toBeGreaterThan(before);
    expect(down).toBeLessThan(before);
  });

  it('goes to an exact value when one was given', () => {
    const { choice } = applySurfaceIntent(defaultSurfaceChoice(), { dial: 'lift', amount: 11 });
    expect(resolveTokens(choice).lift).toBe(11);
  });

  it('stops at the end of the dial rather than past it', () => {
    const { choice } = applySurfaceIntent(defaultSurfaceChoice(), { dial: 'depth', amount: 9000 });
    expect(resolveTokens(choice).depth).toBe(MATERIAL_SPECS.depth.max);
  });

  it('will not run off the end however many times it is nudged', () => {
    let choice = defaultSurfaceChoice();
    for (let i = 0; i < 40; i += 1) {
      choice = applySurfaceIntent(choice, { dial: 'ambient', direction: 'less' }).choice;
    }
    expect(resolveTokens(choice).ambient).toBe(MATERIAL_SPECS.ambient.min);
  });

  /// The caller has to be able to say "that was already how it was" rather than
  /// claiming a change it did not make — which is the failure this whole
  /// application is built against.
  it('reports nothing changed when nothing did', () => {
    const current = { style: 'glass' as const, accent: '#e5484d' };
    expect(applySurfaceIntent(current, { material: 'glass' }).changed).toEqual([]);
    expect(applySurfaceIntent(current, {}).changed).toEqual([]);
    expect(applySurfaceIntent(current, { dial: 'depth', amount: SURFACE_STYLES.glass.tokens.depth }).changed).toEqual(
      []
    );
  });

  it('names every part of a request that moved', () => {
    const { changed } = applySurfaceIntent(defaultSurfaceChoice(), {
      material: 'liquid',
      accent: '#8f5fdb',
      dial: 'ambient',
      amount: 0,
    });
    expect(changed).toEqual(['material', 'accent', 'ambient']);
  });
});
