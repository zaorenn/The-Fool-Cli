/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYOUTS,
  DEFAULT_LAYOUT_ID,
  findLayoutByName,
  LAYOUT_OPTION_KEYS,
  LAYOUT_OPTION_VALUES,
  layoutsForSurface,
  MAX_LAYOUT_PRESETS,
  normalizeLayoutName,
  resolveLayout,
  sanitizeLayoutOptions,
  sanitizeLayoutPresets,
  sanitizeSurfaceLayouts,
  type LayoutPreset,
} from '@/common/config/surfaceLayouts';

/**
 * The shape a window is wearing.
 *
 * Everything here comes back from a config store that the user, another window
 * and a language model can all write to, so the rule is the same as it is for
 * themes: a stored value that cannot be read must degrade to something usable
 * rather than take the surface down with it.
 */

const preset = (name: string, options: Partial<LayoutPreset['options']> = {}): unknown => ({
  name,
  surface: 'voice',
  options: { shell: 'hud', meter: 'ring', panel: 'drawer', motion: 'full', density: 'comfortable', ...options },
});

describe('sanitizeLayoutOptions', () => {
  it('keeps a value this version knows and replaces one it does not', () => {
    const options = sanitizeLayoutOptions({ shell: 'hud', meter: 'spiral', density: 'compact' });

    expect(options.shell).toBe('hud');
    expect(options.density).toBe('compact');
    // Not a value the app has, so the default rather than a broken surface.
    expect(options.meter).toBe('bars');
  });

  it('survives anything that is not a record at all', () => {
    for (const junk of [null, 'hud', 7, []]) {
      expect(sanitizeLayoutOptions(junk).shell).toBe('instrument');
    }
  });

  it('offers every option a value, so no picker can be empty', () => {
    for (const key of LAYOUT_OPTION_KEYS) expect(LAYOUT_OPTION_VALUES[key].length).toBeGreaterThan(1);
  });
});

describe('sanitizeLayoutPresets', () => {
  it('reads back what was saved, under the name it was saved with', () => {
    const library = sanitizeLayoutPresets({ 'my quiet one': preset('My quiet one', { motion: 'calm' }) });

    expect(Object.keys(library)).toEqual(['my quiet one']);
    expect(library['my quiet one'].options.motion).toBe('calm');
    expect(library['my quiet one'].builtin).toBe(false);
  });

  /**
   * A user preset called "hud" that is not the HUD would make every later
   * reference ambiguous — including a spoken one, which is the whole point of
   * names being the user's own words.
   */
  it('refuses a name a built-in already has', () => {
    expect(sanitizeLayoutPresets({ hud: preset('hud') })).toEqual({});
  });

  it('drops an entry that is not a preset rather than repairing it into one', () => {
    expect(sanitizeLayoutPresets({ broken: 'not a preset', '': preset('nameless') })).toEqual({});
  });

  it('keeps the newest when there are more than it will hold', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_LAYOUT_PRESETS + 4 }, (_unused, index) => [`layout ${index}`, preset(`layout ${index}`)])
    );

    const library = sanitizeLayoutPresets(many);

    expect(Object.keys(library)).toHaveLength(MAX_LAYOUT_PRESETS);
    expect(library[`layout ${MAX_LAYOUT_PRESETS + 3}`]).toBeTruthy();
  });
});

describe('sanitizeSurfaceLayouts', () => {
  it('keeps a surface this version has and drops one it does not', () => {
    expect(sanitizeSurfaceLayouts({ voice: 'HUD', kitchen: 'sink' })).toEqual({ voice: 'hud' });
  });
});

describe('resolveLayout', () => {
  const library = sanitizeLayoutPresets({ 'my quiet one': preset('My quiet one', { motion: 'calm' }) });

  it('gives a surface the shape it was told to wear', () => {
    expect(resolveLayout('voice', { voice: 'hud' }, library).id).toBe('hud');
    expect(resolveLayout('voice', { voice: 'my quiet one' }, library).options.motion).toBe('calm');
  });

  /**
   * A selection can outlive the preset it names — someone deletes a layout they
   * were wearing. A window that refuses to draw is worse than one drawn the way
   * it shipped.
   */
  it('falls back to the default rather than failing when the preset is gone', () => {
    expect(resolveLayout('voice', { voice: 'deleted' }, library).id).toBe(DEFAULT_LAYOUT_ID.voice);
    expect(resolveLayout('voice', {}, {}).id).toBe(DEFAULT_LAYOUT_ID.voice);
  });

  it('leaves the shipped default as the default, so an update rearranges nobody’s screen', () => {
    expect(DEFAULT_LAYOUT_ID.voice).toBe('instrument');
  });
});

describe('findLayoutByName, which is how a spoken request lands', () => {
  const library = sanitizeLayoutPresets({ 'my quiet one': preset('My quiet one', { motion: 'calm' }) });

  it('takes the name as it was said, whatever the casing and spacing', () => {
    expect(findLayoutByName('voice', '  HUD  ', library)?.id).toBe('hud');
    expect(findLayoutByName('voice', 'My  Quiet   One', library)?.id).toBe('my quiet one');
  });

  it('takes a part of the name, because that is how people refer to their own things', () => {
    expect(findLayoutByName('voice', 'quiet', library)?.id).toBe('my quiet one');
  });

  it('answers with nothing for a name it does not have, rather than guessing', () => {
    expect(findLayoutByName('voice', 'spaceship', library)).toBeNull();
    expect(findLayoutByName('voice', '   ', library)).toBeNull();
  });
});

describe('layoutsForSurface', () => {
  it('offers the built-ins first, then the ones the user made', () => {
    const library = sanitizeLayoutPresets({ mine: preset('Mine') });
    const available = layoutsForSurface('voice', library);

    expect(available.slice(0, BUILTIN_LAYOUTS.length).every((entry) => entry.builtin)).toBe(true);
    expect(available.at(-1)?.name).toBe('Mine');
  });
});

describe('normalizeLayoutName', () => {
  it('matches the way a name is said rather than the way it was typed', () => {
    expect(normalizeLayoutName('  My   Quiet One ')).toBe('my quiet one');
    expect(normalizeLayoutName('x'.repeat(90))).toHaveLength(48);
  });
});
