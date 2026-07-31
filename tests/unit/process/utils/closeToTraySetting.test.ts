/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  httpRequest: vi.fn(),
  configGet: vi.fn(),
  configSet: vi.fn(),
}));

vi.mock('@/common/adapter/httpBridge', () => ({ httpRequest: mocks.httpRequest }));
vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: { get: mocks.configGet, set: mocks.configSet },
}));

import { readCloseToTrayPreference, readCloseToTraySetting } from '@process/utils/closeToTraySetting';

describe('close-to-tray preference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configSet.mockResolvedValue(undefined);
    mocks.httpRequest.mockResolvedValue({});
  });

  it('reports "never answered" rather than a silent no', async () => {
    mocks.configGet.mockResolvedValue(undefined);

    // This is what makes the app ask on the first close instead of quitting.
    await expect(readCloseToTrayPreference()).resolves.toBeUndefined();
  });

  it('keeps a stored no distinct from no answer at all', async () => {
    mocks.configGet.mockResolvedValue(false);

    await expect(readCloseToTrayPreference()).resolves.toBe(false);
  });

  it('returns the stored yes', async () => {
    mocks.configGet.mockResolvedValue(true);

    await expect(readCloseToTrayPreference()).resolves.toBe(true);
  });

  it('adopts an answer that only exists on the backend', async () => {
    mocks.configGet.mockResolvedValue(undefined);
    mocks.httpRequest.mockResolvedValueOnce({ 'system.closeToTray': true });

    await expect(readCloseToTrayPreference()).resolves.toBe(true);
  });

  it('stays unanswered when the backend cannot be reached', async () => {
    mocks.configGet.mockResolvedValue(undefined);
    mocks.httpRequest.mockRejectedValue(new Error('backend down'));

    await expect(readCloseToTrayPreference()).resolves.toBeUndefined();
  });

  it('reads an unanswered preference as off for callers that need a boolean', async () => {
    mocks.configGet.mockResolvedValue(undefined);

    await expect(readCloseToTraySetting()).resolves.toBe(false);
  });
});
