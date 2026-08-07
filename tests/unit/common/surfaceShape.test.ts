/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { defaultLayoutOptions, SURFACE_IDS, surfaceOptionKeys } from '@/common/config/surfaceLayouts';
import { SHAPE_ATTRIBUTE_PREFIX, shapeAttributeName, surfaceShapeAttributes } from '@/common/config/surfaceShape';

/**
 * Turning a chosen shape into something a stylesheet can answer.
 *
 * The compositions are not four rewritten pages — they are attributes on the
 * document and CSS that responds to them. That is what makes the editor able to
 * shape a surface nobody wrote a second version of, and it is why this is worth
 * pinning: an attribute whose name drifts is a rule that silently stops
 * applying, and a screen that stops obeying its own settings looks like the
 * setting is broken rather than the name.
 */

describe('surfaceShapeAttributes', () => {
  it('names an attribute after the surface and the axis, so two surfaces never collide', () => {
    expect(shapeAttributeName('chat', 'density')).toBe(`${SHAPE_ATTRIBUTE_PREFIX}chat-density`);
    expect(shapeAttributeName('hub', 'density')).toBe(`${SHAPE_ATTRIBUTE_PREFIX}hub-density`);
    expect(shapeAttributeName('chat', 'density')).not.toBe(shapeAttributeName('hub', 'density'));
  });

  it('emits exactly the axes the surface answers, and no others', () => {
    for (const surface of SURFACE_IDS) {
      const emitted = surfaceShapeAttributes(surface, defaultLayoutOptions(surface)).map(([name]) => name);
      const expected = surfaceOptionKeys(surface).map((key) => shapeAttributeName(surface, key));

      expect([...emitted].sort()).toEqual([...expected].sort());
    }
  });

  it('carries the chosen value, not the default', () => {
    const options = { ...defaultLayoutOptions('chat'), bubbles: 'flat' as const, density: 'compact' as const };
    const attributes = new Map(surfaceShapeAttributes('chat', options));

    expect(attributes.get(shapeAttributeName('chat', 'bubbles'))).toBe('flat');
    expect(attributes.get(shapeAttributeName('chat', 'density'))).toBe('compact');
  });

  it('never emits an attribute for an axis the surface has no opinion about', () => {
    const attributes = surfaceShapeAttributes('hub', defaultLayoutOptions('hub')).map(([name]) => name);

    expect(attributes).not.toContain(shapeAttributeName('hub', 'meter'));
    expect(attributes).not.toContain(shapeAttributeName('hub', 'sider'));
  });

  it('produces valid attribute names — lower case, no spaces', () => {
    for (const surface of SURFACE_IDS) {
      for (const [name, value] of surfaceShapeAttributes(surface, defaultLayoutOptions(surface))) {
        expect(name).toMatch(/^data-[a-z-]+$/);
        expect(value).toMatch(/^[a-z]+$/);
      }
    }
  });
});
