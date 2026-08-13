/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The first thing anybody sees.
 *
 * The promise is that somebody is set up and using the application in about ten
 * clicks, and the two things that can quietly break it are a page that throws
 * before it draws and a "Skip" that leaves half a choice behind. A skipped
 * wizard and a fresh install have to be the same application — otherwise the
 * escape hatch is the worst outcome rather than the neutral one.
 */

const stored: Record<string, unknown> = {};
const setMock = vi.fn(async (key: string, value: unknown) => {
  stored[key] = value;
});
const navigate = vi.fn(async () => undefined);
const createConversation = vi.fn(async () => ({ id: 'conversation-1' }));

vi.mock('@/common/config/configService', () => ({
  configService: {
    get: (key: string) => stored[key],
    set: setMock,
    setLocal: vi.fn(),
    subscribe: () => () => undefined,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { create: { invoke: createConversation } },
    acpConversation: { checkManagedAgentHealthById: { invoke: async () => ({ status: 'online' }) } },
  },
}));

vi.mock('@/renderer/hooks/agent/useManagedAgents', () => ({
  getManagedAgents: async () => [
    {
      id: 'builtin-claude',
      name: 'claude',
      backend: 'claude',
      agent_type: 'acp',
      agent_source: 'builtin',
      enabled: true,
      installed: true,
      status: 'online',
    },
  ],
}));

vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: vi.fn() } }));

const WelcomePage = (await import('@renderer/pages/welcome')).default;

describe('the first-run wizard', () => {
  beforeEach(() => {
    for (const key of Object.keys(stored)) delete stored[key];
    setMock.mockClear();
    navigate.mockClear();
    createConversation.mockClear();
    document.documentElement.removeAttribute('data-fool-style');
  });

  it('opens on the agent question, with three steps to go', async () => {
    render(<WelcomePage />);

    await waitFor(() => expect(screen.getByTestId('setup-provider-claude')).toBeTruthy());
    expect(screen.getByTestId('setup-step-agent').dataset.done).toBe('true');
    expect(screen.getByTestId('setup-step-colour').dataset.done).toBe('false');
  });

  it('walks from the agent to the material without leaving for a conversation', async () => {
    render(<WelcomePage />);
    await waitFor(() => expect(screen.getByTestId('setup-provider-claude')).toBeTruthy());

    fireEvent.click(screen.getByTestId('setup-provider-claude'));

    await waitFor(() => expect(screen.getByTestId('material-glass')).toBeTruthy());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('lands in a conversation at the end, having stored what was chosen', async () => {
    render(<WelcomePage />);
    await waitFor(() => expect(screen.getByTestId('setup-provider-claude')).toBeTruthy());

    fireEvent.click(screen.getByTestId('setup-provider-claude'));
    await waitFor(() => expect(screen.getByTestId('material-clay')).toBeTruthy());
    fireEvent.click(screen.getByTestId('material-clay'));
    fireEvent.click(screen.getByTestId('setup-next'));

    await waitFor(() => expect(screen.getByTestId('accent-ramp')).toBeTruthy());
    // Named rather than a hex: colour is chosen from a closed list now, and
    // `moss` is the palette seeded with `#31a074`.
    fireEvent.click(screen.getByTestId('palette-moss'));
    fireEvent.click(screen.getByTestId('setup-next'));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/conversation/conversation-1'));
    expect(stored['ui.surfaceStyle']).toEqual({ style: 'clay', accent: '#31a074' });
  });

  /// Skipping is a real answer, and it has to leave the defaults on rather than
  /// a half-made choice.
  it('stores nothing at all when it is skipped', async () => {
    render(<WelcomePage />);
    await waitFor(() => expect(screen.getByTestId('setup-skip')).toBeTruthy());

    fireEvent.click(screen.getByTestId('setup-skip'));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(setMock).not.toHaveBeenCalled();
  });
});
