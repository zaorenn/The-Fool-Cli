/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Connecting an agent that is not signed in.
 *
 * The panel used to print `claude login` as a line to copy, which is an
 * instruction rather than a flow: find a terminal, paste it, come back — and
 * the middle step is where people stop. The command is still here, but only
 * after starting the sign-in has failed.
 */

const signInToAgent = vi.fn();
const openExternal = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    application: { signInToAgent: { invoke: (request: unknown) => signInToAgent(request) } },
    shell: { openExternal: { invoke: (url: string) => openExternal(url) } },
  },
}));

vi.mock('@renderer/services/setup/detectSetup', () => ({
  detectSetup: async () => ({
    agents: new Map([['claude-code', { installed: true, signedIn: false }]]),
    gateways: new Map(),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Arco's toast mounts itself with the React 17 root API, which React 19 no
// longer has. Only the toast: everything else here is the real component.
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const arco = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...arco, Message: { ...arco.Message, info: vi.fn(), success: vi.fn(), error: vi.fn() } };
});

const { default: SetupPanel } = await import('@renderer/components/settings/SetupPanel');

describe('SetupPanel, for an agent that needs a login', () => {
  beforeEach(() => {
    signInToAgent.mockReset();
    signInToAgent.mockResolvedValue({ success: true });
  });

  it('offers to start the sign-in rather than a line to copy', async () => {
    render(<SetupPanel />);

    const button = await screen.findByText('settings.setup.signInNow');
    expect(screen.queryByText('claude login')).toBeNull();

    fireEvent.click(button);
    await waitFor(() => expect(signInToAgent).toHaveBeenCalledWith({ agentId: 'claude-code' }));
  });

  /// A button that silently does nothing is worse than the command was. When
  /// no terminal could be opened, the old way back is offered.
  it('falls back to the command when no terminal could be opened', async () => {
    signInToAgent.mockResolvedValue({ success: false, msg: 'no terminal' });
    render(<SetupPanel />);

    fireEvent.click(await screen.findByText('settings.setup.signInNow'));

    expect(await screen.findByText('settings.setup.signInFallback')).toBeTruthy();
    expect(screen.getByText('claude login')).toBeTruthy();
  });

  it('falls back the same way when the bridge itself throws', async () => {
    signInToAgent.mockRejectedValue(new Error('bridge gone'));
    render(<SetupPanel />);

    fireEvent.click(await screen.findByText('settings.setup.signInNow'));

    expect(await screen.findByText('settings.setup.signInFallback')).toBeTruthy();
  });
});
