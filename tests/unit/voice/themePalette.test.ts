/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Changing the colour by voice, which is what the user asked for twice and got
 * a success message for instead.
 *
 * The stored conversation history on this machine contains "Hello, can you
 * change the apps theme to something green?" followed by "You didn't do shit."
 * The tool had a `set` action taking a hex value, and it wrote that value to the
 * override layer — which stopped asserting anything when the colour customiser
 * was removed. So the write succeeded, the paint did not happen, and the tool
 * reported that the theme had been set.
 *
 * `app_theme` now offers `palette`, and the nine palettes are the ones already
 * checked against all seven materials in both appearances.
 */

import { describe, expect, it } from 'vitest';
import { REALTIME_TOOLS } from '@/common/realtime';
import { PALETTES } from '@/common/theme/palettes';
import { resolvePalette } from '@renderer/pages/voice/runtime/toolRunner';

describe('the colour a spoken request lands on', () => {
  it('takes the id when the model sends the enum it was given', () => {
    expect(resolvePalette('moss', '')?.id).toBe('moss');
    expect(resolvePalette('  LAGOON ', '')?.id).toBe('lagoon');
  });

  it("takes the user's own word when the model passes that through instead", () => {
    // What a small local model does about half the time: it repeats the word it
    // heard rather than mapping it onto the enum.
    expect(resolvePalette('green', '')?.id).toBe('moss');
    expect(resolvePalette('yeşil', '')?.id).toBe('moss');
    expect(resolvePalette('mavi', '')?.id).toBe('indigo');
    expect(resolvePalette('pembe', '')?.id).toBe('rose');
  });

  it('matches an invented hex to the nearest of the nine rather than using it', () => {
    const chosen = resolvePalette('', '#12a150');
    expect(chosen).not.toBeNull();
    // Whatever it is, it is one of the checked palettes and not the hex itself.
    expect(PALETTES.some((palette) => palette.id === chosen!.id)).toBe(true);
    expect(chosen!.seed).not.toBe('#12a150');
  });

  it('reads a colour word that arrived in the colour field', () => {
    expect(resolvePalette('', 'something green')?.id).toBe('moss');
  });

  it('answers null when no colour was named, rather than picking the first one', () => {
    // The failure this replaces reported success for a change nobody asked for
    // and nobody saw. Null makes the caller raise an error instead.
    expect(resolvePalette('', '')).toBeNull();
    expect(resolvePalette('  ', '   ')).toBeNull();
    expect(resolvePalette('lavender-dreams', '')).toBeNull();
  });
});

describe('the theme tool offers only what it can do', () => {
  const schema = REALTIME_TOOLS.find((tool) => tool.name === 'app_theme');

  it('is still there', () => {
    expect(schema).toBeTruthy();
  });

  it('no longer advertises the actions that wrote to a layer asserting nothing', () => {
    const properties = schema!.parameters.properties as Record<string, { enum?: readonly string[] }>;
    const actions = properties.action?.enum ?? [];

    expect(actions).toContain('palette');
    // `set` wrote a hex to the override layer, `save` and `use` kept and recalled
    // records of that same layer. All three reported success and painted nothing.
    expect(actions).not.toContain('set');
    expect(actions).not.toContain('save');
    expect(actions).not.toContain('use');
  });

  it('names every palette the resolver can return, so the model is asked for ids that exist', () => {
    const properties = schema!.parameters.properties as Record<string, { enum?: readonly string[] }>;
    const offered = [...(properties.palette?.enum ?? [])].toSorted();
    const real = PALETTES.map((palette) => palette.id).toSorted();

    expect(offered).toEqual(real);
  });
});
