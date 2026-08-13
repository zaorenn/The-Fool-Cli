/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The derived palette, in the names the application actually reads.
 *
 * The material writes `--fool-*`, and five files read those. The application
 * reads `--color-bg-*`, `--bg-*`, `--color-text-*` and `--aou-*`, in
 * eighty-six. Until this module existed those eighty-six were painted by four
 * colours somebody picked by hand — which knew nothing about light or dark, and
 * so kept a dark ground winning after a switch to light — and twenty of them
 * were painted by nobody at all, which is why some panels never matched
 * whatever was chosen.
 *
 * Everything here is derived from the palette rather than stored, so a material
 * change moves the whole interface at once and there is no second set of values
 * to keep in step.
 */

import { hexToHsl, hslToHex, type Palette } from '@/common/theme/surfaceStyle';

type Entry = readonly [string, string];

/**
 * A surface `steps` above the card.
 *
 * Away from the ground, in whichever direction the ground is not: lighter on a
 * dark interface, darker on a light one. Four points of lightness per step,
 * which is the separation these surfaces have today.
 */
const elevated = (hex: string, steps: number, awayFromDark: boolean): string => {
  const { h, s, l } = hexToHsl(hex);
  const moved = awayFromDark ? l + steps * 4 : l - steps * 4;
  return hslToHex({ h, s, l: Math.max(0, Math.min(100, moved)) });
};

/**
 * Ink faded towards the surface it sits on.
 *
 * Towards the *surface*, not simply darker. The layer this replaces darkened in
 * both directions — `light ? darken(…) : darken(…)`, a ternary that chose
 * between two identical branches — so in light mode secondary text went heavier
 * than the primary text instead of softer.
 */
const faded = (ink: string, surface: string, amount: number): string => {
  const from = hexToHsl(ink);
  const to = hexToHsl(surface);
  return hslToHex({ h: from.h, s: from.s, l: Math.round(from.l + (to.l - from.l) * amount) });
};

/** Arco wants the accent's channels separately for its own alpha compositing. */
const rgbChannels = (hex: string): string => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
};

export const appVariables = (palette: Palette): readonly Entry[] => {
  const { ground, card, ink, inkSoft, accent, onAccent, lightInk } = palette;

  const step = (n: number): string => elevated(card, n, lightInk);
  const soft = (amount: number): string => faded(inkSoft, card, amount);

  const accentHsl = hexToHsl(accent);
  /** Arco's ramp: step 6 is the accent itself, lighter below it and darker above. */
  const shade = (index: number): string =>
    hslToHex({
      h: accentHsl.h,
      s: accentHsl.s,
      l: Math.max(0, Math.min(100, accentHsl.l + (5 - index) * 6)),
    });

  const primaries: Entry[] = Array.from({ length: 10 }, (_, index) => [`--primary-${index + 1}`, shade(index)]);
  const colorPrimaries: Entry[] = Array.from({ length: 10 }, (_, index) => [
    `--color-primary-${index + 1}`,
    shade(index),
  ]);

  return [
    // The page behind everything.
    ['--bg-1', ground],
    ['--color-bg-1', ground],
    ['--color-bg-0', ground],
    ['--bg-base', ground],
    ['--bg-base-color', ground],
    ['--color-bg-base', ground],
    ['--aou-1', ground],

    // The surface a panel is made of.
    ['--bg-2', card],
    ['--color-bg-2', card],
    ['--aou-2', card],
    ['--dialog-fill-0', card],
    ['--color-bg-popup', card],
    ['--workspace-btn-bg', card],
    ['--color-guid-agent-bar', card],
    ['--fill', card],
    ['--fill-0', card],

    // Raised surfaces, in the order they stack.
    ['--bg-3', step(1)],
    ['--color-bg-3', step(1)],
    ['--aou-3', step(1)],
    ['--bg-hover', step(1)],
    ['--fill-1', step(1)],
    ['--bg-4', step(2)],
    ['--aou-4', step(2)],
    ['--bg-active', step(2)],
    ['--fill-2', step(2)],
    ['--bg-5', step(3)],
    ['--color-bg-5', step(3)],
    ['--aou-5', step(3)],
    ['--fill-3', step(3)],
    ['--bg-6', step(4)],
    ['--color-bg-6', step(4)],
    ['--aou-6', step(4)],
    ['--aou-7', step(5)],
    ['--aou-8', step(6)],
    ['--aou-9', step(7)],
    ['--color-bg-9', step(7)],

    // Ink, and the two fades below it.
    ['--color-text-1', ink],
    ['--text-primary', ink],
    ['--text-0', ink],
    ['--text-base-color', ink],
    ['--text-t-primary', ink],
    ['--color-text-2', inkSoft],
    ['--text-secondary', inkSoft],
    ['--color-text-3', soft(0.25)],
    ['--text-tertiary', soft(0.25)],
    ['--color-text-4', soft(0.5)],
    ['--text-disabled', soft(0.5)],
    ['--text-white', onAccent],

    // The accent, and everything Arco derives from it.
    ...primaries,
    ...colorPrimaries,
    ['--primary', accent],
    ['--primary-rgb', rgbChannels(accent)],
    ['--brand', accent],
    ['--brand-hover', elevated(accent, 1, lightInk)],
    ['--brand-light', elevated(accent, 2, true)],
    ['--color-primary', accent],
    ['--color-primary-base', accent],
    ['--color-primary-light-1', elevated(accent, 1, true)],
    ['--color-primary-light-2', elevated(accent, 2, true)],
    ['--color-primary-light-3', elevated(accent, 3, true)],
    ['--color-primary-dark-1', elevated(accent, 1, false)],
    ['--color-brand-fill', accent],
    ['--aou-6-brand', accent],
  ];
};
