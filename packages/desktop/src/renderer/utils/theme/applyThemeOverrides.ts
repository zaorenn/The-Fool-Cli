/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { defaultThemeOverrides, type ThemeOverrides } from '@/common/config/themeOverrides';
import { SURFACE_IDS } from '@/common/config/surfaceLayouts';

/** Style element holding the user's colour choices. */
const OVERRIDE_STYLE_ID = 'theme-overrides';

/**
 * Every stylesheet the appearance system owns, weakest first.
 *
 * Five separate settings write CSS custom properties into `:root`, and four of
 * them write the *same* properties: a palette, a material, the dials, and the
 * colours the user picked by hand. All of it carries `!important`, because each
 * layer has to outrank the app's own styles to mean anything — and between two
 * important declarations the cascade decides on source order alone.
 *
 * So source order is the whole answer, and until this list existed nobody owned
 * it. Each writer re-appended its own element on every change, which made the
 * winner whichever setting was touched last: choosing a material discarded a
 * colour, and on a cold start the material was written after the colours every
 * time, so a colour somebody picked simply did not survive a restart.
 *
 * The order is an argument, not an accident. A palette is the broadest choice
 * and goes first. A material is chosen after a palette and is more specific, so
 * it goes on top. The dials adjust the material, so they go on top of that. The
 * four colours in the theme customiser are the most deliberate thing here —
 * somebody opened a picker and chose a value — so they win over all of it. The
 * safety net is last and beats everything, because a window nobody can see is
 * not a preference.
 */
const THEME_STYLE_ORDER: readonly string[] = [
  'theme-tokens',
  'theme-decoration',
  'fool-material',
  'fool-layout-tokens',
  ...SURFACE_IDS.map((surface) => `fool-layout-motions-${surface}`),
  OVERRIDE_STYLE_ID,
  'theme-safety-net',
];

/**
 * Puts the appearance stylesheets back in their order, in one pass.
 *
 * Called by everything that writes one of them. Re-appending an element that is
 * already in the head moves it to the end, so walking the list in order leaves
 * them stacked correctly whichever one was just rewritten. Elements that do not
 * exist — a theme with no decoration, a user who never opened the dials — are
 * skipped, and nothing else in the head is touched.
 */
export function restackThemeStyles(root: Document = document): void {
  for (const id of THEME_STYLE_ORDER) {
    const element = root.getElementById(id);
    if (element) root.head.appendChild(element);
  }
}

/** The last overrides applied, so they can be re-asserted after a theme change. */
let lastApplied: ThemeOverrides = defaultThemeOverrides();

/**
 * Nothing, deliberately. Four hand-picked colours no longer outrank the material.
 *
 * This layer wrote `--color-bg-*`, `--bg-*` and `--color-text-*` from a
 * `{ primary, background, surface, text }` record that had no idea which
 * appearance was showing. So a ground chosen in the dark kept winning after a
 * switch to light, and the material's own derivation — which *is* appearance
 * aware, and which measures its ink against the ground it produced — lost to it
 * everywhere. That is why light mode was unusable, and why choosing a different
 * material visibly failed to move most of the interface.
 *
 * The colour somebody chooses is a palette now: a closed list whose every member
 * is checked against every material in both appearances. There is nothing left
 * for this layer to assert, so it asserts nothing and `upsert` removes the
 * element.
 *
 * Kept as a function rather than deleted outright because the stylesheet still
 * has to be restacked on every theme change, and this is the call that does it.
 */
const buildCss = (_overrides: ThemeOverrides): string => '';

const upsert = (css: string, root: Document): void => {
  const existing = root.getElementById(OVERRIDE_STYLE_ID);

  if (!css) {
    existing?.remove();
    // Restacked even with nothing to add: this is the call every theme change
    // ends on, and somebody who has never opened a colour picker still has a
    // material, dials and a safety net that have to end up in the right order.
    restackThemeStyles(root);
    return;
  }

  const element = (existing as HTMLStyleElement | null) ?? root.createElement('style');
  element.id = OVERRIDE_STYLE_ID;
  element.textContent = css;
  root.head.appendChild(element);
  restackThemeStyles(root);
};

/**
 * Applies the user's colour choices over the active theme preset.
 *
 * Written as a stylesheet rather than as inline variables on the root element.
 * Inline styles normally win, but a preset's declarations arrive with
 * `!important` attached, so the only way to layer on top of them — without
 * editing the preset — is an `!important` rule that comes later in the document.
 * Where "later" is decided by {@link THEME_STYLE_ORDER} rather than by which
 * setting the user happened to touch most recently.
 *
 * A colour the user has not chosen is simply absent from the rule, so whatever
 * is underneath — the preset, or the material's derived palette — shows through
 * again.
 */
export function applyThemeOverrides(overrides: ThemeOverrides, root: Document = document): void {
  lastApplied = overrides;
  upsert(buildCss(overrides), root);
}

/**
 * Re-asserts the current overrides, and restacks everything around them.
 *
 * Switching theme rewrites the preset's stylesheet; this puts the whole set back
 * in order afterwards.
 */
export function reassertThemeOverrides(root: Document = document): void {
  upsert(buildCss(lastApplied), root);
}
