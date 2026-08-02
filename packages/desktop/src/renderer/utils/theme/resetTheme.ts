/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { configService } from '@/common/config/configService';
import { defaultThemeOverrides } from '@/common/config/themeOverrides';
import { THE_FOOL_THEME_ID } from '@/common/theme/constants';
import { setActiveTheme } from './applyTheme';
import { applyThemeOverrides } from './applyThemeOverrides';

/**
 * The way back from a theme that made the app unusable.
 *
 * Reached from the tray rather than from a screen, because the screen is the
 * thing that has gone. A stylesheet that hides the window hides the settings
 * page along with it, so an escape hatch drawn inside the app is no escape at
 * all.
 *
 * It puts the appearance back to the shipped default and drops every colour
 * override, and it deliberately does **not** delete the user's themes: the one
 * that broke the window is usually one they spent time on, and they can edit it
 * once they can see again.
 */
export async function resetThemeToDefault(): Promise<void> {
  const overrides = defaultThemeOverrides();
  applyThemeOverrides(overrides);
  await configService.set('ui.themeOverrides', overrides);
  await setActiveTheme(THE_FOOL_THEME_ID);
}
