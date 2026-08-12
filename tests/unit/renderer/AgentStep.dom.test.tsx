/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The first screen showing what it actually found.
 *
 * The backend resolves around thirty agents on `$PATH`; this step used to name
 * two of them in a constant, so a machine with Gemini or Cursor on it was shown
 * a screen that had not noticed. These assertions are about the screen telling
 * the truth about the machine.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import AgentStep from '@renderer/pages/welcome/AgentStep';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

const agent = (backend: string, status: ManagedAgent['status'], overrides: Partial<ManagedAgent> = {}): ManagedAgent =>
  ({
    id: `builtin-${backend}`,
    name: backend.toUpperCase(),
    backend,
    agent_type: 'acp',
    agent_source: 'builtin',
    enabled: true,
    installed: status !== 'missing',
    status,
    ...overrides,
  }) as ManagedAgent;

const renderStep = (agents: ManagedAgent[], onChoose = vi.fn()) => {
  render(<AgentStep agents={agents} loading={false} checking={null} onChoose={onChoose} />);
  return onChoose;
};

describe('AgentStep', () => {
  it('offers an agent the old two-name list would have hidden', () => {
    renderStep([agent('cursor', 'online')]);

    expect(screen.getByTestId('setup-provider-cursor')).toBeTruthy();
  });

  it('shows each agent under its own name rather than a hardcoded label', () => {
    renderStep([agent('gemini', 'online', { name: 'Gemini CLI' })]);

    expect(screen.getByText('Gemini CLI')).toBeTruthy();
  });

  it('hands the whole choice back, so the caller does not have to look it up again', () => {
    const onChoose = renderStep([agent('codex', 'online')]);

    screen.getByTestId('setup-provider-codex').click();

    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ status: 'connected' }));
  });

  it('says so plainly when nothing was found, instead of offering a guess', () => {
    renderStep([]);

    expect(screen.getByTestId('setup-no-agents')).toBeTruthy();
  });

  it('shows at most a screenful even when the machine has everything', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((name) => agent(name, 'online'));

    renderStep(many);

    expect(screen.getAllByRole('button')).toHaveLength(6);
  });

  it('shows a spinner rather than an empty state while it is still looking', () => {
    render(<AgentStep agents={[]} loading checking={null} onChoose={vi.fn()} />);

    expect(screen.queryByTestId('setup-no-agents')).toBeNull();
  });
});
