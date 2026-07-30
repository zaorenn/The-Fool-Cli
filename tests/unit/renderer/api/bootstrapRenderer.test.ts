/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { configInitializeMock, configGetMock, consoleErrorMock, applyThemeOverridesMock } = vi.hoisted(() => ({
  configInitializeMock: vi.fn(),
  configGetMock: vi.fn(),
  consoleErrorMock: vi.fn(),
  applyThemeOverridesMock: vi.fn(),
}));

vi.mock('@/common/config/configService', () => ({
  configService: {
    initialize: configInitializeMock,
    get: configGetMock,
  },
}));

vi.mock('@renderer/utils/theme/applyThemeOverrides', () => ({
  applyThemeOverrides: applyThemeOverridesMock,
}));

describe('bootstrapRendererConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('waits for configService initialization to finish', async () => {
    configInitializeMock.mockResolvedValue(undefined);
    const { bootstrapRendererConfig } = await import('@/renderer/services/bootstrapRenderer');

    await bootstrapRendererConfig(consoleErrorMock);

    expect(configInitializeMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorMock).not.toHaveBeenCalled();
  });

  it('swallows initialization failures so app bootstrap can continue', async () => {
    const error = new Error('boom');
    configInitializeMock.mockRejectedValue(error);
    const { bootstrapRendererConfig } = await import('@/renderer/services/bootstrapRenderer');

    await expect(bootstrapRendererConfig(consoleErrorMock)).resolves.toBeUndefined();
    expect(consoleErrorMock).toHaveBeenCalledWith('Failed to initialize config:', error);
  });

  it('re-applies the saved theme colours, so a customised colour survives a restart', async () => {
    configInitializeMock.mockResolvedValue(undefined);
    configGetMock.mockReturnValue({ colors: { primary: '#c4123f' } });
    const { bootstrapRendererConfig } = await import('@/renderer/services/bootstrapRenderer');

    await bootstrapRendererConfig(consoleErrorMock);

    expect(configGetMock).toHaveBeenCalledWith('ui.themeOverrides');
    expect(applyThemeOverridesMock).toHaveBeenCalledWith({ colors: { primary: '#c4123f' } });
  });

  it('still starts when the saved colours cannot be applied', async () => {
    configInitializeMock.mockResolvedValue(undefined);
    configGetMock.mockReturnValue({ colors: {} });
    applyThemeOverridesMock.mockImplementationOnce(() => {
      throw new Error('no document');
    });
    const { bootstrapRendererConfig } = await import('@/renderer/services/bootstrapRenderer');

    await expect(bootstrapRendererConfig(consoleErrorMock)).resolves.toBeUndefined();
    expect(consoleErrorMock).toHaveBeenCalledWith('Failed to apply saved theme colours:', expect.any(Error));
  });
});
