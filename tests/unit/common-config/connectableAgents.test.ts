/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  CONNECTABLE_AGENTS,
  hasReadyAgent,
  nextStepFor,
  orderForSetup,
  type AgentPresence,
  type ConnectableAgentId,
} from '@/common/config/connectableAgents';

const found = (entries: Partial<Record<ConnectableAgentId, AgentPresence>>) =>
  new Map(Object.entries(entries) as [ConnectableAgentId, AgentPresence][]);

const agent = (id: ConnectableAgentId) => CONNECTABLE_AGENTS.find((candidate) => candidate.id === id)!;

describe('nextStepFor', () => {
  it('offers to use one that is installed and signed in', () => {
    expect(nextStepFor(agent('claude-code'), { installed: true, signedIn: true })).toBe('use');
  });

  it('offers the sign-in when the CLI is there but the account is not', () => {
    expect(nextStepFor(agent('claude-code'), { installed: true, signedIn: false })).toBe('sign-in');
  });

  it('offers the install when nothing is there', () => {
    expect(nextStepFor(agent('codex'), { installed: false })).toBe('install');
  });

  it('does not ask for a sign-in an agent does not have', () => {
    // Gemini CLI has no login step of ours to run. Offering one sends the user
    // hunting for a command that does not exist.
    expect(agent('gemini').signIn).toBeUndefined();
    expect(nextStepFor(agent('gemini'), { installed: true })).toBe('use');
  });

  it('treats an unknown sign-in state as ready rather than blocking', () => {
    // Being wrong here costs one failed run that says why. Being wrong the
    // other way puts a sign-in screen in front of somebody already signed in.
    expect(nextStepFor(agent('claude-code'), { installed: true })).toBe('use');
  });
});

describe('orderForSetup', () => {
  it('puts what is ready first and what is missing last', () => {
    const order = orderForSetup(
      found({
        'claude-code': { installed: false },
        codex: { installed: true, signedIn: false },
        gemini: { installed: true },
      })
    );

    expect(order.map((entry) => entry.agent.id)).toEqual(['gemini', 'codex', 'claude-code']);
    expect(order.map((entry) => entry.step)).toEqual(['use', 'sign-in', 'install']);
  });

  it('still lists everything when nothing is installed', () => {
    // Somebody with none of them still has to be told what to install.
    const order = orderForSetup(found({}));

    expect(order).toHaveLength(CONNECTABLE_AGENTS.length);
    expect(order.every((entry) => entry.step === 'install')).toBe(true);
  });
});

describe('hasReadyAgent', () => {
  it('knows when the panel can simply be skipped', () => {
    expect(hasReadyAgent(found({ codex: { installed: true, signedIn: true } }))).toBe(true);
    expect(hasReadyAgent(found({ codex: { installed: true, signedIn: false } }))).toBe(false);
    expect(hasReadyAgent(found({}))).toBe(false);
  });
});

describe('the catalogue', () => {
  it('gives every agent something to run and somewhere to read', () => {
    for (const entry of CONNECTABLE_AGENTS) {
      expect(entry.command, entry.id).toMatch(/^\w[\w-]*$/);
      expect(entry.install, entry.id).toContain('install');
      expect(entry.docs, entry.id).toMatch(/^https:\/\//);
    }
  });
});
