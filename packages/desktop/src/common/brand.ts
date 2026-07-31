/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const PRODUCT_NAME = 'The Fool' as const;
export const PRODUCT_SHORT_NAME = 'Fool' as const;
export const PRODUCT_SLUG = 'the-fool' as const;
export const PRODUCT_EXECUTABLE_NAME = 'TheFool' as const;
export const PRODUCT_PROTOCOL = 'thefool' as const;
export const APP_ID = 'com.thefool.app' as const;
export const LEGAL_ATTRIBUTION = 'Based on AionUi — Apache-2.0' as const;
export const UPSTREAM_SOURCE_URL = 'https://github.com/iOfficeAI/AionUi' as const;

/**
 * The repository releases are published to and pulled from.
 *
 * Everything about updating — the electron-updater feed, the GitHub release
 * listing, the download host allowlist — resolves from this one constant, so a
 * fork only has to change it here.
 */
export const PRODUCT_REPO_OWNER = 'zaorenn' as const;
export const PRODUCT_REPO_NAME = 'The-Fool-Cli' as const;
export const PRODUCT_REPO = `${PRODUCT_REPO_OWNER}/${PRODUCT_REPO_NAME}` as const;
export const PRODUCT_REPO_URL = `https://github.com/${PRODUCT_REPO}` as const;

export const AUTO_UPDATE_ENABLED = true as const;
export const PRODUCT_SUPPORT_URL: string | null = `${PRODUCT_REPO_URL}/issues`;
export const PRODUCT_UPDATE_URL: string | null = `${PRODUCT_REPO_URL}/releases/latest`;
