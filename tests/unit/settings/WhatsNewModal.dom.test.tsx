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

import WhatsNewModal, { decideWhatsNew, splitEmphasis } from '@/renderer/components/settings/WhatsNewModal';

const ENTRIES: ReleaseNoteEntry[] = [
  { version: '2.4.0', sections: [{ title: 'Features', items: ['A thing that is new.'] }] },
];

const answerWith = (currentVersion: string, entries: ReleaseNoteEntry[]) => {
  mocks.releaseNotesMock.mockResolvedValue({ success: true, data: { currentVersion, entries } });
};

/**
 * What this copy of the app has on disk before the modal looks.
 *
 * `ranBefore` stands for the saved window bounds: the main process writes them
 * when the window is moved or closed, so any prior session leaves a record and
 * a first launch on a machine leaves none.
 */
const storedState = ({ lastSeen, ranBefore }: { lastSeen?: string; ranBefore?: boolean }) => {
  mocks.configGetMock.mockImplementation((key: string) =>
    Promise.resolve(key === 'system.lastSeenVersion' ? lastSeen : ranBefore ? { width: 1200, height: 800 } : undefined)
  );
};

describe('decideWhatsNew', () => {
  it('stays quiet on a fresh install, which has missed nothing', () => {
    expect(decideWhatsNew(undefined, '2.4.0', ENTRIES, false)).toBe('record');
  });

  it('speaks on the very update that adds it, to somebody who was already here', () => {
    // Nothing recorded, but this installation has run before — so it is an
    // existing copy arriving from a build older than this feature.
    // Answering "record" here would make a feature whose whole job is to say
    // what changed ship silent on the one update that introduces it.
    expect(decideWhatsNew(undefined, '2.4.0', ENTRIES, true)).toBe('show');
  });

  it('does nothing at all when the recorded version is the one running', () => {
    expect(decideWhatsNew('2.4.0', '2.4.0', ENTRIES, true)).toBe('nothing');
  });

  it('shows the notes when the version moved and there is something to read', () => {
    expect(decideWhatsNew('2.3.9', '2.4.0', ENTRIES, true)).toBe('show');
  });

  it('records without showing when the version moved but there is nothing to read', () => {
    expect(decideWhatsNew('2.3.9', '2.4.0', [], true)).toBe('record');
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
    storedState({ lastSeen: '2.3.9', ranBefore: true });
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

  it('says nothing on a fresh install, and records the version so the next update can', async () => {
    storedState({});
    answerWith('2.4.0', ENTRIES);

    render(<WhatsNewModal />);

    await waitFor(() => expect(mocks.configSetMock).toHaveBeenCalledWith('system.lastSeenVersion', '2.4.0'));
    expect(screen.queryByText('A thing that is new.')).toBeNull();
  });

  it('speaks to an existing install arriving from a build that never recorded one', async () => {
    storedState({ ranBefore: true });
    answerWith('2.4.0', ENTRIES);

    render(<WhatsNewModal />);

    await screen.findByText('A thing that is new.');
    expect(mocks.releaseNotesMock).toHaveBeenCalledWith({ since: undefined });
  });

  it('says nothing when the app has not changed version', async () => {
    storedState({ lastSeen: '2.4.0', ranBefore: true });
    answerWith('2.4.0', []);

    render(<WhatsNewModal />);

    await waitFor(() => expect(mocks.releaseNotesMock).toHaveBeenCalled());
    expect(mocks.configSetMock).not.toHaveBeenCalled();
    expect(screen.queryByText('update.whatsNew.dismiss')).toBeNull();
  });

  it('does not interrupt a launch when the notes cannot be read', async () => {
    storedState({ lastSeen: '2.3.9', ranBefore: true });
    mocks.releaseNotesMock.mockRejectedValue(new Error('bridge is not there'));

    render(<WhatsNewModal />);

    await waitFor(() => expect(mocks.releaseNotesMock).toHaveBeenCalled());
    expect(screen.queryByText('update.whatsNew.dismiss')).toBeNull();
    expect(mocks.configSetMock).not.toHaveBeenCalled();
  });
});

/**
 * The asterisks a reader should never see.
 *
 * Every bullet in this project's changelog opens with a bold sentence saying
 * what changed. Rendered as plain text the reader got the markup instead —
 * `**The first word took four minutes.** Measured on…` — and the first release
 * anybody saw this dialogue for was full of them.
 */
describe('a changelog line', () => {
  it('reads the bold lead-in as emphasis rather than as asterisks', () => {
    expect(splitEmphasis('**It is faster now.** Measured on this machine.')).toEqual([
      { text: 'It is faster now.', strong: true },
      { text: ' Measured on this machine.', strong: false },
    ]);
  });

  it('leaves a line with no emphasis exactly as it was', () => {
    expect(splitEmphasis('Nothing bold here.')).toEqual([{ text: 'Nothing bold here.', strong: false }]);
  });

  it('handles emphasis in the middle, and more than one', () => {
    expect(splitEmphasis('before **one** between **two** after')).toEqual([
      { text: 'before ', strong: false },
      { text: 'one', strong: true },
      { text: ' between ', strong: false },
      { text: 'two', strong: true },
      { text: ' after', strong: false },
    ]);
  });

  /// An empty run would render an element with nothing in it, and an unclosed
  /// one is a line the author wrote — neither should eat the text around it.
  it('leaves stray asterisks alone', () => {
    expect(splitEmphasis('****')).toEqual([{ text: '****', strong: false }]);
    expect(splitEmphasis('an **unclosed lead-in')).toEqual([{ text: 'an **unclosed lead-in', strong: false }]);
  });

  it('keeps an empty line an empty line', () => {
    expect(splitEmphasis('')).toEqual([{ text: '', strong: false }]);
  });
});
