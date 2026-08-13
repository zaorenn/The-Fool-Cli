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
 *
 * The panel raises them as callbacks rather than performing them; the container
 * owns the shell and the clipboard. So what is asserted here is which actions
 * are offered and which node they are raised for — the decisions this component
 * actually makes.
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/pages/conversation/explorer/monitorTransport', () => ({ initExplorerRuntime: () => ({}) }));

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

const REVEAL = 'conversation.workspace.contextMenu.openLocation';
const COPY_ABSOLUTE = 'conversation.explorer.contextMenu.copyAbsolutePath';
const COPY_RELATIVE = 'conversation.explorer.contextMenu.copyRelativePath';

const onRevealInFolder = vi.fn();
const onCopyAbsolutePath = vi.fn();
const onCopyRelativePath = vi.fn();

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
    render(
      <ExplorerPanel
        projectId='p1'
        roots={roots}
        workspacePeId={roots[0]?.pe_id}
        onRevealInFolder={onRevealInFolder}
        onCopyAbsolutePath={onCopyAbsolutePath}
        onCopyRelativePath={onCopyRelativePath}
      />
    );
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
  onRevealInFolder.mockClear();
  onCopyAbsolutePath.mockClear();
  onCopyRelativePath.mockClear();
  isElectronDesktop.mockReturnValue(true);
});
afterEach(() => cleanup());

describe('explorer path actions', () => {
  it('offers reveal and copy for a root the app can locate', async () => {
    await renderPanel([withPath]);

    expect(screen.getAllByText(REVEAL).length).toBeGreaterThan(0);
    expect(screen.getAllByText(COPY_ABSOLUTE).length).toBeGreaterThan(0);
  });

  it('offers neither for a root whose folder has no path', async () => {
    await renderPanel([withoutPath]);

    expect(screen.queryByText(REVEAL)).toBeNull();
    expect(screen.queryByText(COPY_ABSOLUTE)).toBeNull();
  });

  it('withholds both outside the desktop app, where they would name somebody else’s machine', async () => {
    isElectronDesktop.mockReturnValue(false);

    await renderPanel([withPath]);

    expect(screen.queryByText(REVEAL)).toBeNull();
    expect(screen.queryByText(COPY_ABSOLUTE)).toBeNull();
  });

  it('raises the reveal for the node it was asked on', async () => {
    await renderPanel([withPath]);

    act(() => screen.getAllByText(REVEAL)[0].click());

    expect(onRevealInFolder).toHaveBeenCalledWith('pe-1', '');
  });

  it('raises the absolute-path copy for the node it was asked on', async () => {
    await renderPanel([withPath]);

    act(() => screen.getAllByText(COPY_ABSOLUTE)[0].click());

    expect(onCopyAbsolutePath).toHaveBeenCalledWith('pe-1', '', 'app');
  });

  it('does not offer a relative path on a root, which would be empty', async () => {
    await renderPanel([withPath]);

    expect(screen.queryByText(COPY_RELATIVE)).toBeNull();
  });
});
