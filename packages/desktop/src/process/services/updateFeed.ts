/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Modified from the original: the feed now resolves to this project's GitHub
 * releases instead of the upstream CDN.
 */

import { PRODUCT_REPO_NAME, PRODUCT_REPO_OWNER } from '@/common/brand';

/**
 * Where electron-updater looks for `latest*.yml` and the installers beside it.
 *
 * Upstream served releases from its own CDN through a custom generic provider.
 * That host only ever carried upstream's builds, so a fork inherits a feed that
 * answers 404 forever — silently, because a missing feed reads the same as "no
 * update yet". Releases here come from the repo they are published to.
 */
export type GithubFeedOptions = {
  provider: 'github';
  owner: string;
  repo: string;
};

export function buildUpdateFeedOptions(): GithubFeedOptions {
  return {
    provider: 'github',
    owner: PRODUCT_REPO_OWNER,
    repo: PRODUCT_REPO_NAME,
  };
}
