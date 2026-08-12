/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the first screen offers, and in what order.
 *
 * The backend detects around thirty agents on `$PATH`; the wizard used to name
 * two of them by hand. These assertions are about the replacement: everything
 * found, best first, and nothing the user has already said no to.
 */

import { describe, expect, it } from 'vitest';
import {
  getOnboardingStatus,
  hasConnectedAgent,
  onboardingChoices,
  ONBOARDING_LIMIT,
} from '@/renderer/pages/welcome/welcomeModel';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

const agent = (backend: string, status: ManagedAgent['status'], overrides: Partial<ManagedAgent> = {}): ManagedAgent =>
  ({
    id: `builtin-${backend}`,
    name: backend,
    backend,
    agent_type: 'acp',
    agent_source: 'builtin',
    enabled: true,
    installed: status !== 'missing',
    status,
    ...overrides,
  }) as ManagedAgent;

describe('getOnboardingStatus', () => {
  it('maps catalog state to an honest onboarding state', () => {
    expect(getOnboardingStatus(undefined)).toBe('unavailable');
    expect(getOnboardingStatus(agent('codex', 'missing'))).toBe('missing');
    expect(getOnboardingStatus(agent('codex', 'online'))).toBe('connected');
    expect(getOnboardingStatus(agent('claude', 'offline'))).toBe('needs-auth');
    expect(getOnboardingStatus(agent('claude', 'unchecked'))).toBe('ready-to-check');
  });
});

describe('onboardingChoices', () => {
  it('offers every agent the backend found, not a hand-written pair', () => {
    const found = [agent('claude', 'online'), agent('gemini', 'offline'), agent('cursor', 'online')];

    expect(
      onboardingChoices(found)
        .map((choice) => choice.agent.backend)
        .toSorted()
    ).toEqual(['claude', 'cursor', 'gemini']);
  });

  it('puts what already works first, then what needs a login, then what is missing', () => {
    const found = [
      agent('droid', 'missing'),
      agent('gemini', 'offline'),
      agent('codex', 'online'),
      agent('kimi', 'unchecked'),
    ];

    expect(onboardingChoices(found).map((choice) => choice.agent.backend)).toEqual([
      'codex',
      'kimi',
      'gemini',
      'droid',
    ]);
  });

  it('breaks ties by name, so the same machine shows the same screen twice', () => {
    const found = [agent('zed', 'online'), agent('auggie', 'online')];

    expect(onboardingChoices(found).map((choice) => choice.agent.backend)).toEqual(['auggie', 'zed']);
  });

  it('leaves out an agent the user has switched off', () => {
    const found = [agent('codex', 'online'), agent('goose', 'online', { enabled: false })];

    expect(onboardingChoices(found).map((choice) => choice.agent.backend)).toEqual(['codex']);
  });

  it('leaves out a row with no backend, which is not something anyone recognises', () => {
    const found = [agent('codex', 'online'), agent('', 'online', { backend: undefined })];

    expect(onboardingChoices(found)).toHaveLength(1);
  });

  it('returns nothing when nothing was found, rather than inventing a suggestion', () => {
    expect(onboardingChoices([])).toEqual([]);
  });

  it('shows at most a screenful', () => {
    expect(ONBOARDING_LIMIT).toBeLessThanOrEqual(8);
  });
});

describe('hasConnectedAgent', () => {
  it('is true when something is ready to use right now', () => {
    expect(hasConnectedAgent(onboardingChoices([agent('codex', 'online')]))).toBe(true);
  });

  it('is false when everything found still needs a login', () => {
    expect(hasConnectedAgent(onboardingChoices([agent('codex', 'offline')]))).toBe(false);
  });

  it('is false when nothing was found at all', () => {
    expect(hasConnectedAgent([])).toBe(false);
  });
});
