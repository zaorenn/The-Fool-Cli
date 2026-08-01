/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const isElectronDesktopMock = vi.fn();

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => isElectronDesktopMock(),
  resolveExtensionAssetUrl: (url: string) => url,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

vi.mock('@/renderer/hooks/system/useExtensionSettingsTabs', () => ({
  useExtensionSettingsTabs: () => [],
}));

vi.mock('@/renderer/hooks/system/useExtI18n', () => ({
  useExtI18n: () => ({ resolveExtTabName: (name: string) => name }),
}));

import SettingsSider from '@renderer/pages/settings/components/SettingsSider';

const renderSider = (desktop: boolean) => {
  isElectronDesktopMock.mockReturnValue(desktop);
  render(
    <MemoryRouter initialEntries={['/settings/overview']}>
      <SettingsSider />
    </MemoryRouter>
  );
};

/**
 * The WebUI is the mobile version: a phone opens the desktop machine's server
 * over the LAN and runs the same renderer. What it does not have is an Electron
 * main process, and two settings pages are nothing but calls into one.
 *
 * The pet lives in its own always-on-top native windows. Voice installs model
 * weights on the host machine and drives a native engine through IPC channels
 * that the WebUI host does not serve at all — so on a phone the page can only
 * ever load an empty catalog and report that it could not be read.
 */
describe('Settings navigation in browser mode', () => {
  afterEach(() => {
    isElectronDesktopMock.mockReset();
  });

  it('offers every page on the desktop', () => {
    renderSider(true);

    expect(screen.getByText('pet.desktopPet')).toBeTruthy();
    expect(screen.getByText('settings.voice.title')).toBeTruthy();
  });

  it('hides the pages that have no backend in a browser', () => {
    renderSider(false);

    expect(screen.queryByText('pet.desktopPet')).toBeNull();
    expect(screen.queryByText('settings.voice.title')).toBeNull();
  });

  // Everything that is served by foolcore rather than by Electron works over
  // the LAN exactly as it does on the desktop, and must not be hidden with it.
  it('keeps the pages a phone can actually use', () => {
    renderSider(false);

    expect(screen.getByText('settings.model')).toBeTruthy();
    expect(screen.getByText('Agents')).toBeTruthy();
    expect(screen.getByText('settings.about')).toBeTruthy();
  });
});
