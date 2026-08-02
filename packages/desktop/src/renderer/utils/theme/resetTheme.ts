/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import { defaultThemeOverrides } from '@/common/config/themeOverrides';
import { THE_FOOL_THEME_ID } from '@/common/theme/constants';
import type { Theme } from '@/common/theme/types';
import { BUILTIN_THEMES } from '@renderer/theme/builtinThemes';
import { applyTheme } from './applyTheme';
import { applyThemeOverrides } from './applyThemeOverrides';

/**
 * The way back from a theme that made the app unusable.
 *
 * Reached from the tray rather than from a screen, because the screen is the
 * thing that has gone: a stylesheet that hides the window hides the settings
 * page with it, so an escape hatch drawn inside the app is no escape at all.
 *
 * It switches to The Fool's own built-in theme and drops every colour override.
 * Not "reload whatever is selected" — the selected one is usually the thing
 * that broke, so re-resolving it would land straight back on it.
 *
 * The route matters as much as the destination. This deliberately does **not**
 * go through `setActiveTheme`, which resolves the id against
 * `[...BUILTIN_THEMES, ...userThemes]` and therefore has to read and spread the
 * user's stored themes. That store is the one piece of data a recovery path
 * cannot assume is sound — a malformed value there would throw, and the one
 * button that is supposed to work when everything else has failed would fail
 * too. The built-in theme is a constant in this bundle, so it is taken from
 * there and applied directly.
 *
 * The user's own themes are left alone. The one that broke the window is
 * usually one they spent time on, and they can edit it once they can see again.
 */
export async function resetThemeToDefault(): Promise<void> {
  const builtin = BUILTIN_THEMES.find((theme: Theme) => theme.id === THE_FOOL_THEME_ID) ?? BUILTIN_THEMES[0];

  // Paint first, persist second. Whatever happens to storage, the user can see
  // again by the time this returns.
  const overrides = defaultThemeOverrides();
  applyTheme(builtin);
  applyThemeOverrides(overrides);

  try {
    await configService.set('ui.themeOverrides', overrides);
    await configService.set('theme.activeId', builtin.id);
    await ipcBridge.theme.setActive.invoke(builtin);
  } catch (error) {
    // The window is readable again either way; a failed write means the theme
    // comes back on restart, which is worth saying rather than swallowing.
    console.error('[theme] reset applied but could not be saved:', error);
  }
}
