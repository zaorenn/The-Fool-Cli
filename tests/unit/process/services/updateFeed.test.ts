/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { PRODUCT_REPO_NAME, PRODUCT_REPO_OWNER } from '@/common/brand';
import { buildUpdateFeedOptions } from '@/process/services/updateFeed';

describe('update feed options', () => {
  it('points electron-updater at this project GitHub releases', () => {
    const options = buildUpdateFeedOptions();

    expect(options.provider).toBe('github');
    expect(options.owner).toBe(PRODUCT_REPO_OWNER);
    expect(options.repo).toBe(PRODUCT_REPO_NAME);
  });

  it('does not resolve to the upstream release CDN', () => {
    const serialized = JSON.stringify(buildUpdateFeedOptions());

    expect(serialized).not.toContain('aionui');
    expect(serialized).not.toContain('iOfficeAI');
  });
});
