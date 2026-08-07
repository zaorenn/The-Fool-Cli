/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * JARVIS's motion, pinned where it cannot be checked by looking.
 *
 * Every rule in this stylesheet is loaded on every launch of the app, under
 * every palette, and is kept inert by nothing but a selector. Two ways that
 * goes wrong are silent: a rule that forgets its scope decorates somebody's
 * plain dark theme with corner brackets, and a rule that forgets the
 * reduced-motion escape keeps pulsing at a person who asked the operating
 * system for stillness. Neither shows up in a screenshot of JARVIS itself,
 * which is the only place anyone would think to look.
 */

const CINEMA_PATH = path.resolve(__dirname, '../../../packages/desktop/src/renderer/styles/jarvis-cinema.css');
const css = readFileSync(CINEMA_PATH, 'utf-8');
/** The rules alone. The prose in this file talks about the properties it sets. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Selectors, with comments and at-rule bodies' declarations stripped away. */
const selectors = (): string[] => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutComments
    .split('}')
    .map((block) => block.split('{')[0].trim())
    .filter(Boolean)
    .filter((selector) => !selector.startsWith('@'))
    .filter((selector) => !/^\d|^from$|^to$/.test(selector));
};

describe('the JARVIS cinema stylesheet', () => {
  it('scopes every rule to the palette, so no other theme ever wears it', () => {
    const unscoped = selectors().filter((selector) =>
      selector
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .some((part) => !part.includes("data-theme-id='jarvis'"))
    );

    expect(unscoped).toEqual([]);
  });

  it('names every keyframe it plays, and plays every keyframe it names', () => {
    const declared = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]));
    const played = new Set(
      [...css.matchAll(/animation:\s*([\s\S]*?);/g)].flatMap((match) =>
        [...declared].filter((name) => match[1].includes(name))
      )
    );

    expect([...declared].sort()).toEqual([...played].sort());
  });

  it('stands down for anyone who asked the system for less motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');

    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    // The two full-window layers are removed outright rather than paused: a
    // scan band frozen mid-window is worse than no scan band.
    expect(reduced).toContain('display: none');
    expect(reduced).toContain('animation: none !important');
  });

  it("honours the app's own movement dial as well as the operating system's", () => {
    expect(css).toContain("html[data-fool-frame-motion='none'][data-theme-id='jarvis']");
    expect(css).toContain("html[data-fool-frame-motion='calm'][data-theme-id='jarvis']");
  });

  it('keeps the arrival under calm, and drops what repeats', () => {
    const calm = css.slice(css.indexOf("html[data-fool-frame-motion='calm']"));

    expect(calm).toContain('jarvis-boot-resolve');
    expect(calm).not.toContain('jarvis-grid-drift');
    expect(calm).not.toContain('jarvis-reactor');
  });

  it('lets nothing ambient sit between the reader and the app', () => {
    // Every layer that covers the window is `pointer-events: none`. There are
    // four of them and a missed one makes the app unclickable, which is the
    // single worst thing a decorative stylesheet can do.
    const covering = rules.match(/position:\s*fixed/g) ?? [];
    const inert = rules.match(/pointer-events:\s*none/g) ?? [];

    expect(covering.length).toBeGreaterThan(0);
    expect(inert.length).toBe(covering.length);
  });
});
