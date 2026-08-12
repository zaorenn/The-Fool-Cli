/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The three context-menu actions that answer questions about the machine.
 *
 * Everything else in this menu is about the project — add to chat, rename,
 * remove. These three are about where the thing actually is, and they are only
 * offerable when the app knows: a root whose folder the backend could not render
 * as a path has no absolute path to reveal, and a browser talking to a remote
 * backend would be revealing a folder on somebody else's machine.
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/pages/conversation/explorer/monitorTransport', () => ({ initExplorerRuntime: () => ({}) }));

const showItemInFolder = vi.fn();
vi.mock('@/common', () => ({
  ipcBridge: { shell: { showItemInFolder: { invoke: (...args: unknown[]) => showItemInFolder(...args) } } },
}));

const copyText = vi.fn();
vi.mock('@/renderer/utils/ui/clipboard', () => ({ copyText: (...args: unknown[]) => copyText(...args) }));

const isElectronDesktop = vi.fn(() => true);
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => isElectronDesktop() }));

import type { DirRef, Entry, PeKey, RootRef } from '@/renderer/pages/conversation/explorer/explorerModel';
import { refToKey } from '@/renderer/pages/conversation/explorer/explorerModel';
import type { MonitorPort } from '@/renderer/pages/conversation/explorer/explorerStore';
import {
  configureExplorerStore,
  resetExplorerStoreForTest,
} from '@/renderer/pages/conversation/explorer/explorerStore';
import { ExplorerPanel } from '@/renderer/pages/conversation/explorer/ExplorerPanel';

const REVEAL = 'conversation.explorer.contextMenu.revealInFolder';
const COPY_PATH = 'conversation.explorer.contextMenu.copyPath';
const COPY_RELATIVE = 'conversation.explorer.contextMenu.copyRelativePath';

const port = (snapshots: Record<PeKey, Entry[]>): MonitorPort => ({
  subscribe: async (refs: DirRef[]) => ({
    snapshots: refs.map((ref) => ({ target: ref, entries: snapshots[refToKey(ref)] ?? [] })),
  }),
  unsubscribe: () => {},
});

const flush = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

/**
 * Renders the tree and opens the root node's context menu.
 *
 * arco builds the droplist only once the menu is asked for, so every assertion
 * here needs the right-click first — querying without it finds nothing and would
 * pass for the wrong reason.
 */
const renderPanel = async (roots: RootRef[]) => {
  configureExplorerStore(port({}));
  await act(async () => {
    render(<ExplorerPanel projectId='p1' roots={roots} workspacePeId={roots[0]?.pe_id} />);
    await flush();
  });

  const node = await screen.findByText(roots[0].title);
  await act(async () => {
    fireEvent.contextMenu(node);
    await flush();
  });
};

const withPath: RootRef = { pe_id: 'pe-1', title: 'app', role: 'workspace', path: '/home/me/app' };
const withoutPath: RootRef = { pe_id: 'pe-2', title: 'nowhere', role: 'workspace' };

beforeEach(() => {
  resetExplorerStoreForTest();
  localStorage.clear();
  showItemInFolder.mockClear();
  copyText.mockClear();
  isElectronDesktop.mockReturnValue(true);
});
afterEach(() => cleanup());

describe('explorer path actions', () => {
  it('offers reveal and copy for a root the app can locate', async () => {
    await renderPanel([withPath]);

    expect(screen.getAllByText(REVEAL).length).toBeGreaterThan(0);
    expect(screen.getAllByText(COPY_PATH).length).toBeGreaterThan(0);
  });

  it('offers neither for a root whose folder has no path', async () => {
    await renderPanel([withoutPath]);

    expect(screen.queryByText(REVEAL)).toBeNull();
    expect(screen.queryByText(COPY_PATH)).toBeNull();
  });

  it('withholds reveal outside the desktop app, where it would open somebody else’s folder', async () => {
    isElectronDesktop.mockReturnValue(false);

    await renderPanel([withPath]);

    expect(screen.queryByText(REVEAL)).toBeNull();
    // Copying a path is still a sensible thing to do from a browser.
    expect(screen.getAllByText(COPY_PATH).length).toBeGreaterThan(0);
  });

  it('reveals the absolute path when the action is taken', async () => {
    await renderPanel([withPath]);

    act(() => screen.getAllByText(REVEAL)[0].click());

    expect(showItemInFolder).toHaveBeenCalledWith('/home/me/app');
  });

  it('copies the absolute path when the action is taken', async () => {
    await renderPanel([withPath]);

    act(() => screen.getAllByText(COPY_PATH)[0].click());

    expect(copyText).toHaveBeenCalledWith('/home/me/app');
  });

  it('does not offer a relative path on a root, which would be empty', async () => {
    await renderPanel([withPath]);

    expect(screen.queryByText(COPY_RELATIVE)).toBeNull();
  });
});
