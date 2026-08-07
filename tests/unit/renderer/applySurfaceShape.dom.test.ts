/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { defaultLayoutOptions, SURFACE_IDS } from '@/common/config/surfaceLayouts';
import { shapeAttributeName } from '@/common/config/surfaceShape';
import { applySurfaceShape, clearSurfaceShapes } from '@renderer/utils/theme/applySurfaceShape';

/**
 * A chosen shape reaching the document.
 *
 * This is the join between the editor and the stylesheet, and it is the join
 * that fails silently: an attribute that never lands leaves every rule written
 * against it inert, and the surface goes on looking exactly as it did. Nobody
 * gets an error — they get a settings page whose switches do nothing.
 */

describe('applySurfaceShape', () => {
  beforeEach(() => {
    clearSurfaceShapes();
  });

  it("puts a surface's choices on the document root", () => {
    applySurfaceShape('chat', { ...defaultLayoutOptions('chat'), bubbles: 'flat', density: 'compact' });

    expect(document.documentElement.getAttribute(shapeAttributeName('chat', 'bubbles'))).toBe('flat');
    expect(document.documentElement.getAttribute(shapeAttributeName('chat', 'density'))).toBe('compact');
  });

  it('replaces a previous choice rather than leaving it underneath', () => {
    applySurfaceShape('hub', { ...defaultLayoutOptions('hub'), cards: 'list' });
    applySurfaceShape('hub', { ...defaultLayoutOptions('hub'), cards: 'grid' });

    expect(document.documentElement.getAttribute(shapeAttributeName('hub', 'cards'))).toBe('grid');
  });

  it('leaves the other surfaces alone', () => {
    applySurfaceShape('chat', { ...defaultLayoutOptions('chat'), density: 'compact' });
    applySurfaceShape('hub', { ...defaultLayoutOptions('hub'), density: 'comfortable' });

    expect(document.documentElement.getAttribute(shapeAttributeName('chat', 'density'))).toBe('compact');
    expect(document.documentElement.getAttribute(shapeAttributeName('hub', 'density'))).toBe('comfortable');
  });

  it('writes an attribute for every surface the app has', () => {
    for (const surface of SURFACE_IDS) applySurfaceShape(surface, defaultLayoutOptions(surface));

    for (const surface of SURFACE_IDS) {
      expect(document.documentElement.getAttribute(shapeAttributeName(surface, 'motion'))).toBe('full');
    }
  });

  it('clears everything it owns, so a preview can start from nothing', () => {
    for (const surface of SURFACE_IDS) applySurfaceShape(surface, defaultLayoutOptions(surface));
    clearSurfaceShapes();

    for (const surface of SURFACE_IDS) {
      expect(document.documentElement.hasAttribute(shapeAttributeName(surface, 'motion'))).toBe(false);
    }
  });
});
