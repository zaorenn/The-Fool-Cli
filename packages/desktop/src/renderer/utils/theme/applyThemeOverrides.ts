/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  THEME_COLOR_KEYS,
  colorVariables,
  defaultThemeOverrides,
  shellBackgroundCss,
  type ThemeOverrides,
} from '@/common/config/themeOverrides';

/** Style element holding the user's colour choices. */
const OVERRIDE_STYLE_ID = 'theme-overrides';

/**
 * Selectors the presets themselves use, so the override matches their reach.
 *
 * A preset declares its palette for `:root` and for the appearance attributes;
 * repeating that list keeps the override applicable whichever one is active.
 */
const ROOT_SELECTORS = [
  ':root',
  "[data-theme='dark']",
  "[data-theme='light']",
  "body[arco-theme='dark']",
  "body[arco-theme='light']",
].join(',\n');

/** The last overrides applied, so they can be re-asserted after a theme change. */
let lastApplied: ThemeOverrides = defaultThemeOverrides();

const buildCss = (overrides: ThemeOverrides): string => {
  const declarations: string[] = [];

  for (const key of THEME_COLOR_KEYS) {
    const hex = overrides.colors[key];
    if (!hex) continue;
    for (const [cssVar, value] of colorVariables(key, hex)) {
      // `!important` is not belt-and-braces here: theme presets are injected
      // through the custom-CSS processor, which stamps `!important` onto their
      // declarations. Without it the user's colour loses to the preset it is
      // supposed to override.
      declarations.push(`  ${cssVar}: ${value} !important;`);
    }
  }

  if (declarations.length === 0) return '';

  const rules = [`${ROOT_SELECTORS} {\n${declarations.join('\n')}\n}`];

  // Presets also paint the window shell with a literal colour, which no variable
  // can reach.
  const shell = overrides.colors.background ? shellBackgroundCss(overrides.colors.background) : null;
  if (shell) rules.push(shell);

  return rules.join('\n\n');
};

const upsert = (css: string, root: Document): void => {
  const existing = root.getElementById(OVERRIDE_STYLE_ID);

  if (!css) {
    existing?.remove();
    return;
  }

  const element = (existing as HTMLStyleElement | null) ?? root.createElement('style');
  element.id = OVERRIDE_STYLE_ID;
  element.textContent = css;
  // Re-appended every time so it stays after the active theme's stylesheet:
  // equal importance is decided by source order.
  root.head.appendChild(element);
};

/**
 * Applies the user's colour choices over the active theme preset.
 *
 * Written as a stylesheet rather than as inline variables on the root element.
 * Inline styles normally win, but a preset's declarations arrive with
 * `!important` attached, so the only way to layer on top of them — without
 * editing the preset — is an `!important` rule that comes later in the document.
 *
 * A colour the user has not chosen is simply absent from the rule, so the
 * preset's own value shows through again.
 */
export function applyThemeOverrides(overrides: ThemeOverrides, root: Document = document): void {
  lastApplied = overrides;
  upsert(buildCss(overrides), root);
}

/**
 * Re-asserts the current overrides.
 *
 * Switching theme re-appends the preset's stylesheet, which would otherwise end
 * up after the override and win on source order.
 */
export function reassertThemeOverrides(root: Document = document): void {
  upsert(buildCss(lastApplied), root);
}
