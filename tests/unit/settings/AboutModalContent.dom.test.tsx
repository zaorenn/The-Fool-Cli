/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
  quitAndInstall: vi.fn(),
  updateCheck: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    autoUpdate: { quitAndInstall: { invoke: mocks.quitAndInstall } },
    shell: { openFile: { invoke: vi.fn() } },
    update: { check: { invoke: mocks.updateCheck } },
  },
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
  openExternalUrl: mocks.openExternalUrl,
}));

vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'modal',
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/FeedbackReportModal', () => ({
  default: () => null,
}));

import AboutModalContent from '@/renderer/components/settings/SettingsModal/contents/AboutModalContent';

const LEGAL_ATTRIBUTION = 'Based on AionUi — Apache-2.0';
const UPSTREAM_SOURCE_URL = 'https://github.com/iOfficeAI/AionUi';

describe('AboutModalContent private alpha identity', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', '2.1.43');
    mocks.openExternalUrl.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows The Fool attribution without exposing upstream update actions', () => {
    render(<AboutModalContent />);

    expect(screen.getByRole('heading', { name: 'The Fool' })).toBeInTheDocument();
    expect(screen.getAllByText(LEGAL_ATTRIBUTION)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'settings.checkForUpdates' })).toBeNull();
    expect(mocks.updateCheck).not.toHaveBeenCalled();
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
  });

  it('opens the attributed upstream source without presenting it as The Fool support', () => {
    render(<AboutModalContent />);

    const attributionLinks = screen.getAllByText(LEGAL_ATTRIBUTION);
    fireEvent.click(attributionLinks[attributionLinks.length - 1]);

    expect(mocks.openExternalUrl).toHaveBeenCalledWith(UPSTREAM_SOURCE_URL);
  });
});
