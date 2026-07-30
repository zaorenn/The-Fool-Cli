/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { configService } from '@/common/config/configService';
import { THEME_OVERRIDES_CONFIG_KEY, sanitizeThemeOverrides } from '@/common/config/themeOverrides';
import { applyThemeOverrides } from '@renderer/utils/theme/applyThemeOverrides';

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
}
