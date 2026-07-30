/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  THEME_COLOR_KEYS,
  THEME_COLOR_SPECS,
  colorVariables,
  radiusVariables,
  type ThemeOverrides,
} from '@/common/config/themeOverrides';

/**
 * Writes theme overrides to the root element's CSS variables.
 *
 * Follows the same approach as `applyFontSizes`: setting variables on the root
 * is what makes a picker update the whole window immediately, with no reload
 * and no stylesheet rewrite.
 *
 * A colour the user has not overridden has its variable *removed* rather than
 * set, so the active preset's own value shows through again.
 */
export function applyThemeOverrides(overrides: ThemeOverrides, root: Document = document): void {
  const { style } = root.documentElement;

  for (const key of THEME_COLOR_KEYS) {
    const hex = overrides.colors[key];
    if (hex) {
      for (const [cssVar, value] of colorVariables(key, hex)) style.setProperty(cssVar, value);
      continue;
    }
    const spec = THEME_COLOR_SPECS[key];
    for (const cssVar of [spec.cssVar, ...(spec.alsoSet ?? [])]) style.removeProperty(cssVar);
  }

  for (const [cssVar, value] of radiusVariables(overrides.radiusPx)) style.setProperty(cssVar, value);
}
