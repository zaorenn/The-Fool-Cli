/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultWorkspace, type Workspace } from '@/common/config/workspaces';

/**
 * Fool's Hub: choosing what the app is for today.
 *
 * The assertion that matters most is not that the page draws. It is that
 * *choosing* a workspace does something — a picker that stored a choice and left
 * the app exactly as it was would be a label rather than a workspace, and the
 * user would find that out one setting at a time.
 */

const entered: Workspace[] = [];
const saved: Workspace[] = [];
const removed: string[] = [];
let library: Workspace[] = [];
let active: Workspace = defaultWorkspace();

vi.mock('@renderer/hooks/config/useWorkspaces', () => ({
  useWorkspaces: () => ({
    workspaces: library,
    active,
    enter: async (workspace: Workspace) => {
      entered.push(workspace);
      active = workspace;
    },
    save: async (workspace: Workspace) => {
      saved.push(workspace);
      return workspace;
    },
    remove: async (id: string) => {
      removed.push(id);
      return true;
    },
    capture: (name: string, description: string) => ({
      ...defaultWorkspace(),
      id: name.toLowerCase(),
      name,
      description,
      builtin: false,
    }),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const FoolsHubPage = (await import('@renderer/pages/hub')).default;

const guitar: Workspace = {
  ...defaultWorkspace(),
  id: 'guitar',
  name: 'Guitar',
  description: 'Turns a link into tab',
  builtin: false,
  layouts: { voice: 'hud' },
  agent: { assistantId: 'a', providerId: 'p', modelId: 'gemma-4-e4b' },
};

beforeEach(() => {
  entered.length = 0;
  saved.length = 0;
  removed.length = 0;
  active = defaultWorkspace();
  library = [defaultWorkspace(), guitar];
});

describe('Fool’s Hub', () => {
  it('shows every workspace, the shipped one included', () => {
    render(<FoolsHubPage />);

    expect(screen.getByTestId('workspace-default')).toBeTruthy();
    expect(screen.getByTestId('workspace-guitar')).toBeTruthy();
  });

  /**
   * A list of names would be quicker to build and useless to choose from: the
   * point of a workspace is that it moves several settings at once.
   */
  it('says what switching to one would actually change', () => {
    render(<FoolsHubPage />);

    const card = screen.getByTestId('workspace-guitar');
    expect(card.textContent).toContain('hub.factLayout');
    expect(card.textContent).toContain('hub.factModel');
  });

  it('switches to one when it is chosen', async () => {
    render(<FoolsHubPage />);

    fireEvent.click(screen.getByTestId('workspace-guitar').querySelector('button') as HTMLButtonElement);

    await waitFor(() => expect(entered.map((workspace) => workspace.id)).toEqual(['guitar']));
  });

  it('marks the one in use, and does not offer to switch to it again', () => {
    active = guitar;
    render(<FoolsHubPage />);

    const button = screen.getByTestId('workspace-guitar').querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('disabled')).not.toBeNull();
  });

  /**
   * The shipped one is the app's, not the user's: there has to be something to
   * fall back to when everything else has been deleted.
   */
  it('offers no delete on the shipped workspace', () => {
    render(<FoolsHubPage />);

    const shipped = screen.getByTestId('workspace-default');
    const guitarCard = screen.getByTestId('workspace-guitar');
    expect(shipped.querySelectorAll('button')).toHaveLength(2);
    expect(guitarCard.querySelectorAll('button')).toHaveLength(3);
  });

  it('keeps the app as it is arranged now, under a name', async () => {
    render(<FoolsHubPage />);

    fireEvent.change(screen.getByTestId('workspace-name'), { target: { value: 'Writing' } });
    fireEvent.click(screen.getByText('hub.make'));

    await waitFor(() => expect(saved.map((workspace) => workspace.name)).toEqual(['Writing']));
  });

  it('will not make one with no name, because a name is how it is recalled', () => {
    render(<FoolsHubPage />);

    expect(screen.getByText('hub.make').closest('button')?.getAttribute('disabled')).not.toBeNull();
  });
});
