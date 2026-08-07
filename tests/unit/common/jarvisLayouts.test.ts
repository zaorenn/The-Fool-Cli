/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { JARVIS_LAYOUT_ID, JARVIS_LAYOUTS } from '@/common/config/jarvisLayouts';
import { MOTION_TARGET_SELECTOR, sanitizeMotions } from '@/common/config/layoutMotions';
import { defaultLayoutTokens } from '@/common/config/layoutTokens';
import { layoutsForSurface, resolveLayout, SURFACE_IDS, surfaceOptionKeys } from '@/common/config/surfaceLayouts';
import { JARVIS_WORKSPACE_ID, sanitizeWorkspaces } from '@/common/config/workspaces';
import { JARVIS_THEME_ID } from '@/common/theme/constants';

/**
 * The worked example, kept worth showing.
 *
 * JARVIS ships to be the answer to "what can this actually do" — somebody wears
 * it, likes something, opens the editor and finds that thing sitting there to be
 * taken apart. That only works while it genuinely uses the system: a preset that
 * quietly drifted back to the defaults would still look fine and would teach
 * nothing, and nobody would notice, because there is no error in a demonstration
 * that has stopped demonstrating.
 */

describe('the JARVIS layouts', () => {
  it('shapes every window, not a favourite one', () => {
    for (const surface of SURFACE_IDS) {
      expect(JARVIS_LAYOUTS.some((preset) => preset.surface === surface)).toBe(true);
    }
  });

  it('appears in the picker for its own surface and nowhere else', () => {
    for (const surface of SURFACE_IDS) {
      const offered = layoutsForSurface(surface, {}).map((preset) => preset.id);
      expect(offered).toContain(JARVIS_LAYOUT_ID[surface]);

      const strangers = SURFACE_IDS.filter((other) => other !== surface).map((other) => JARVIS_LAYOUT_ID[other]);
      for (const stranger of strangers) expect(offered).not.toContain(stranger);
    }
  });

  it('turns dials rather than leaving them, which is the point of shipping it', () => {
    const shipped = defaultLayoutTokens();

    for (const preset of JARVIS_LAYOUTS) {
      const moved = Object.keys(shipped).filter(
        (key) => preset.tokens[key as keyof typeof shipped] !== shipped[key as keyof typeof shipped]
      );
      expect(moved.length).toBeGreaterThan(0);
    }
  });

  it('answers every question its surface asks, so no axis is left at the default by accident', () => {
    for (const preset of JARVIS_LAYOUTS) {
      for (const key of surfaceOptionKeys(preset.surface)) {
        expect(preset.options[key]).toBeTruthy();
      }
    }
  });

  it('carries movements a person could have built in the editor', () => {
    const built = JARVIS_LAYOUTS.flatMap((preset) => preset.motions);
    expect(built.length).toBeGreaterThan(0);

    // Survives the same reading a stored preset gets: nothing here is a shape
    // the editor could not produce or the sanitiser would drop.
    for (const preset of JARVIS_LAYOUTS) {
      expect(sanitizeMotions(preset.motions)).toHaveLength(preset.motions.length);
    }

    for (const motion of built) expect(MOTION_TARGET_SELECTOR[motion.target]).toBeTruthy();
  });

  it('moves at least three of the five things that can move, across the set', () => {
    const targets = new Set(JARVIS_LAYOUTS.flatMap((preset) => preset.motions).map((motion) => motion.target));
    expect(targets.size).toBeGreaterThanOrEqual(3);
  });
});

describe('the JARVIS workspace', () => {
  const jarvis = () => sanitizeWorkspaces({})[JARVIS_WORKSPACE_ID];

  it('ships, and cannot be edited away', () => {
    expect(jarvis()?.builtin).toBe(true);
  });

  it('names a JARVIS layout for every window', () => {
    for (const surface of SURFACE_IDS) {
      expect(jarvis()?.layouts[surface]).toBe(JARVIS_LAYOUT_ID[surface]);
    }
  });

  it('brings its own palette, which is what makes it a look rather than a rearrangement', () => {
    expect(jarvis()?.theme).toBe(JARVIS_THEME_ID);
  });

  it('says who the assistant is being, in its own words', () => {
    expect((jarvis()?.voice.instructions ?? '').length).toBeGreaterThan(80);
  });

  it('resolves to a real layout on every surface once it is worn', () => {
    const worn = jarvis()?.layouts ?? {};

    for (const surface of SURFACE_IDS) {
      const resolved = resolveLayout(surface, worn, {});
      expect(resolved.id).toBe(JARVIS_LAYOUT_ID[surface]);
      expect(resolved.surface).toBe(surface);
    }
  });
});
