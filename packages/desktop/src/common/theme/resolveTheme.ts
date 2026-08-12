/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Theme } from './types';
import { DEFAULT_THEME_ID, LIGHT_THEME_ID, DARK_THEME_ID, SYSTEM_THEME_ID } from './constants';

/**
 * Pure: caller supplies the full theme list (builtins + user).
 *
 * `system` resolves to the built-in Dark/Light theme via `prefersDark` (callers
 * pass the `prefers-color-scheme` media query result; this module must stay
 * DOM-free).
 *
 * An id that names nothing — a theme deleted from another window, a stored value
 * from an older version — falls back to the app's own default rather than to
 * Light. Landing on a palette nobody picked is worse than landing on the one the
 * app ships with.
 */
export function resolveActiveTheme(activeId: string, themes: Theme[], prefersDark?: boolean): Theme {
  const targetId = activeId === SYSTEM_THEME_ID ? (prefersDark ? DARK_THEME_ID : LIGHT_THEME_ID) : activeId;
  return (
    themes.find((t) => t.id === targetId) ??
    themes.find((t) => t.id === DEFAULT_THEME_ID) ??
    themes.find((t) => t.id === LIGHT_THEME_ID) ??
    themes[0]
  );
}
