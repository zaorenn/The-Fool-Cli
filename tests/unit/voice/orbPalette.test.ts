/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { orbPalette, readHex } from '@renderer/orb/palette';
import { ORB_SKINS, orbSkinById } from '@renderer/orb/skins';
import { DEFAULT_ORB_SKIN } from '@/common/config/configKeys';

/**
 * The one part of the orb worth testing on its own.
 *
 * Everything else it does is pixels. This is the rule that decides whether
 * those pixels belong to the theme the user chose — and the pet window cannot
 * see a stylesheet, so if this is wrong the orb is simply a different colour
 * from the rest of the application with nothing to point at.
 */
describe('the orb takes its colours from the accent', () => {
  it('reads an accent in either notation', () => {
    expect(readHex('#e2445c')).toEqual([226, 68, 92]);
    expect(readHex('#abc')).toEqual([170, 187, 204]);
    expect(readHex('e2445c')).toEqual([226, 68, 92]);
  });

  /// The accent arrives over IPC from another process. A malformed one has to
  /// produce a grey orb rather than an exception in a window with no console
  /// anybody will ever read.
  it('falls back to a neutral rather than throwing on rubbish', () => {
    expect(readHex('')).toEqual([136, 136, 136]);
    expect(readHex('not a colour')).toEqual([136, 136, 136]);
  });

  it('keeps the accent itself intact whatever the stage', () => {
    for (const stage of ['listening', 'speaking', 'processing'] as const) {
      expect(orbPalette('#e2445c', stage).accent).toEqual([226, 68, 92]);
    }
  });

  /// Not fixed colours. A fixed green for "listening" clashes with half the
  /// palettes somebody might choose; a green derived from their accent cannot.
  it('gives each stage its own tint, derived rather than fixed', () => {
    const listening = orbPalette('#e2445c', 'listening').tint;
    const thinking = orbPalette('#e2445c', 'processing').tint;
    const speaking = orbPalette('#e2445c', 'speaking').tint;

    expect(listening).not.toEqual(thinking);
    expect(thinking).not.toEqual(speaking);
    expect(listening).not.toEqual(speaking);
  });

  it('moves every tint when the accent moves', () => {
    const red = orbPalette('#e2445c', 'listening').tint;
    const blue = orbPalette('#3d6fe0', 'listening').tint;
    expect(red).not.toEqual(blue);
  });

  /// An orb is a light source; an accent chosen to be read as text on a page is
  /// not. A very dark or very pale accent still has to glow.
  it('lifts a near-black and pulls down a near-white so both still glow', () => {
    for (const accent of ['#000000', '#ffffff', '#050505', '#fafafa']) {
      const [r, g, b] = orbPalette(accent, 'speaking').tint;
      const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
      expect(lightness, accent).toBeGreaterThan(0.3);
      expect(lightness, accent).toBeLessThan(0.78);
    }
  });

  it('leans the neutral toward the accent rather than using a flat grey', () => {
    const ink = orbPalette('#3d6fe0', 'listening').ink;
    expect(new Set(ink).size).toBeGreaterThan(1);
  });
});

/**
 * The registry, which is the whole of "a different animation later".
 */
describe('choosing an orb', () => {
  it('finds a skin by the id that is stored', () => {
    expect(orbSkinById('pulse').id).toBe('pulse');
  });

  /// An id in a config file a user can edit by hand, and a skin that may be
  /// removed in a later version. A window that cannot draw looks exactly like a
  /// window that crashed.
  it('falls back rather than leaving the window blank', () => {
    expect(orbSkinById('a skin that never existed').id).toBe(DEFAULT_ORB_SKIN);
    expect(orbSkinById(undefined).id).toBe(DEFAULT_ORB_SKIN);
  });

  it('ships more than one, so the contract has actually been exercised', () => {
    expect(ORB_SKINS.length).toBeGreaterThan(1);
  });

  it('gives every skin an id, a label and a description for the picker', () => {
    for (const skin of ORB_SKINS) {
      expect(skin.id.length, skin.id).toBeGreaterThan(0);
      expect(skin.label.length, skin.id).toBeGreaterThan(0);
      expect(skin.about.length, skin.id).toBeGreaterThan(10);
    }
  });

  it('has no two skins claiming the same id', () => {
    expect(new Set(ORB_SKINS.map((skin) => skin.id)).size).toBe(ORB_SKINS.length);
  });
});
