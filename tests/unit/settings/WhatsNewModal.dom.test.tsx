/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseNoteEntry } from '@/common/update/releaseNotes';

const mocks = vi.hoisted(() => ({
  releaseNotesMock: vi.fn(),
  configGetMock: vi.fn(),
  configSetMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${vars.version}` : key),
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    update: {
      releaseNotes: { invoke: mocks.releaseNotesMock },
    },
  },
}));

vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    get: mocks.configGetMock,
    set: mocks.configSetMock,
  },
}));

import WhatsNewModal, { decideWhatsNew } from '@/renderer/components/settings/WhatsNewModal';

const ENTRIES: ReleaseNoteEntry[] = [
  { version: '2.4.0', sections: [{ title: 'Features', items: ['A thing that is new.'] }] },
];

const answerWith = (currentVersion: string, entries: ReleaseNoteEntry[]) => {
  mocks.releaseNotesMock.mockResolvedValue({ success: true, data: { currentVersion, entries } });
};

describe('decideWhatsNew', () => {
  it('stays quiet and records the version when nothing was ever recorded', () => {
    expect(decideWhatsNew(undefined, '2.4.0', ENTRIES)).toBe('record');
  });

  it('does nothing at all when the recorded version is the one running', () => {
    expect(decideWhatsNew('2.4.0', '2.4.0', ENTRIES)).toBe('nothing');
  });

  it('shows the notes when the version moved and there is something to read', () => {
    expect(decideWhatsNew('2.3.9', '2.4.0', ENTRIES)).toBe('show');
  });

  it('records without showing when the version moved but there is nothing to read', () => {
    expect(decideWhatsNew('2.3.9', '2.4.0', [])).toBe('record');
  });
});

describe('WhatsNewModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configSetMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('shows what changed after an update, and remembers it once dismissed', async () => {
    mocks.configGetMock.mockResolvedValue('2.3.9');
    answerWith('2.4.0', ENTRIES);

    render(<WhatsNewModal />);

    await screen.findByText('A thing that is new.');
    expect(screen.getByText('update.whatsNew.title:2.4.0')).toBeTruthy();
    // Not recorded while it is still on screen: a window closed by a crash has
    // to show the same notes again rather than lose them.
    expect(mocks.configSetMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('update.whatsNew.dismiss'));

    await waitFor(() => expect(mocks.configSetMock).toHaveBeenCalledWith('system.lastSeenVersion', '2.4.0'));
    expect(mocks.releaseNotesMock).toHaveBeenCalledWith({ since: '2.3.9' });
  });

  it('says nothing on a first launch, and records the version so the next update can', async () => {
    mocks.configGetMock.mockResolvedValue(undefined);
    answerWith('2.4.0', ENTRIES);

    render(<WhatsNewModal />);

    await waitFor(() => expect(mocks.configSetMock).toHaveBeenCalledWith('system.lastSeenVersion', '2.4.0'));
    expect(screen.queryByText('A thing that is new.')).toBeNull();
  });

  it('says nothing when the app has not changed version', async () => {
    mocks.configGetMock.mockResolvedValue('2.4.0');
    answerWith('2.4.0', []);

    render(<WhatsNewModal />);

    await waitFor(() => expect(mocks.releaseNotesMock).toHaveBeenCalled());
    expect(mocks.configSetMock).not.toHaveBeenCalled();
    expect(screen.queryByText('update.whatsNew.dismiss')).toBeNull();
  });

  it('does not interrupt a launch when the notes cannot be read', async () => {
    mocks.configGetMock.mockResolvedValue('2.3.9');
    mocks.releaseNotesMock.mockRejectedValue(new Error('bridge is not there'));

    render(<WhatsNewModal />);

    await waitFor(() => expect(mocks.releaseNotesMock).toHaveBeenCalled());
    expect(screen.queryByText('update.whatsNew.dismiss')).toBeNull();
    expect(mocks.configSetMock).not.toHaveBeenCalled();
  });
});
