/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { PALETTES, nearestPalette, paletteById, paletteForRequest } from '@/common/theme/palettes';
import { ACCENT_SUGGESTIONS } from '@/common/theme/surfaceStyle';

describe('palette catalogue', () => {
  it('offers exactly the accents already proven readable in every material', () => {
    expect(PALETTES.map((palette) => palette.seed)).toEqual([...ACCENT_SUGGESTIONS]);
  });

  it('gives every palette a distinct id and something to be asked for by', () => {
    expect(new Set(PALETTES.map((palette) => palette.id)).size).toBe(PALETTES.length);
    for (const palette of PALETTES) expect(palette.keywords.length).toBeGreaterThan(0);
  });

  it('falls back rather than throwing on an id nobody recognises', () => {
    expect(paletteById('nonsense')).toBe(PALETTES[0]);
  });

  it('resolves a spoken request in either language', () => {
    expect(paletteForRequest('temayı yeşil tonlarında istiyorum')?.id).toBe('moss');
    expect(paletteForRequest('make the theme green')?.id).toBe('moss');
    expect(paletteForRequest('mor yap')?.id).toBe('orchid');
  });

  it('says nothing when no colour was named', () => {
    expect(paletteForRequest('make it bigger')).toBeNull();
  });

  /**
   * A model cannot reach past the list. This is the whole reason the picker is
   * being removed: an arbitrary hex has never been checked against any material.
   */
  it('cannot be talked into a colour that was never vetted', () => {
    expect(paletteForRequest('use #ff00ff please')).toBeNull();
  });

  it('maps a stored hand-picked colour to the palette closest in hue', () => {
    expect(nearestPalette('#8f5fdb').id).toBe('orchid');
    expect(nearestPalette('#e5484d').id).toBe('ember');
  });

  it('sends a grey to the neutral palette rather than to a rounded hue', () => {
    expect(nearestPalette('#2f2f2f').id).toBe('slate');
  });
});
