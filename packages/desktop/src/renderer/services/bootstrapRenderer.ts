/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { configService } from '@/common/config/configService';
import { THEME_OVERRIDES_CONFIG_KEY, sanitizeThemeOverrides } from '@/common/config/themeOverrides';
import { applyThemeOverrides } from '@renderer/utils/theme/applyThemeOverrides';
import { applySurfaceChoice, peekSurfaceChoice } from '@renderer/hooks/config/useSurfaceStyle';

type BootstrapLogger = (message?: unknown, ...optionalParams: unknown[]) => void;

/**
 * Wait for renderer config initialization without coupling app bootstrap to
 * business data prefetches such as `/api/agents`.
 */
export async function bootstrapRendererConfig(logError: BootstrapLogger = console.error): Promise<void> {
  await configService.initialize().catch((err) => {
    logError('Failed to initialize config:', err);
  });

  // Saved colour overrides are re-applied here, before the first paint. They live
  // as inline variables on the root element, which a theme preset's stylesheet
  // cannot overwrite — that is what lets a colour be customised without editing
  // the preset. Applying them only when the Appearance page mounted meant a saved
  // colour quietly vanished on every restart.
  try {
    applyThemeOverrides(sanitizeThemeOverrides(configService.get(THEME_OVERRIDES_CONFIG_KEY)));
  } catch (err) {
    logError('Failed to apply saved theme colours:', err);
  }

  // And the material it is all made of, for the same reason and at the same
  // moment. Applied here rather than by the first component that happens to
  // mount, so the application is never briefly the material somebody stopped
  // using — a flash of the old look is the whole of what this setting is for.
  //
  // Guarded on the document rather than only caught, because this function is
  // also called where there is no page. "There is nothing to paint" is not a
  // failure, and reporting it as one puts an error in front of somebody that
  // says nothing is wrong.
  if (typeof document === 'undefined') return;
  try {
    applySurfaceChoice(peekSurfaceChoice());
  } catch (err) {
    logError('Failed to apply the saved material:', err);
  }
}
