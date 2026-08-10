/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  CONNECTABLE_AGENTS,
  connectableAgent,
  connectableAgentForCommand,
  hasReadyAgent,
  LINUX_TERMINALS,
  nextStepFor,
  orderForSetup,
  signInLaunchFor,
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

  /**
   * This used to assert that Gemini had no sign-in, on the belief that it had
   * no login step to run. Checked against the installed CLI, that is wrong: it
   * authenticates on its first interactive launch. The belief was costing the
   * user the whole feature — the agent settings diagnosed "Needs Sign-in" and
   * then offered nothing that signs in.
   */
  it('offers a sign-in for every agent that has one', () => {
    expect(agent('gemini').signIn).toBe('gemini');
    expect(nextStepFor(agent('gemini'), { installed: true, signedIn: false })).toBe('sign-in');
    expect(nextStepFor(agent('gemini'), { installed: true, signedIn: true })).toBe('use');
  });

  it('still asks for nothing when an agent declares no sign-in', () => {
    const bare = { id: 'gemini' as const, label: 'X', command: 'x', install: 'x', docs: 'x' };
    expect(nextStepFor(bare, { installed: true, signedIn: false })).toBe('use');
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

/**
 * The sign-in, started rather than described.
 *
 * The panel printed `claude login` as a line to copy: find a terminal, paste,
 * come back. Three steps, and the middle one is where people stop. Every one of
 * these CLIs opens a browser and waits — all that was missing was something to
 * start it.
 */
describe('starting a sign-in', () => {
  const claude = CONNECTABLE_AGENTS.find((agent) => agent.id === 'claude-code');
  const gemini = CONNECTABLE_AGENTS.find((agent) => agent.id === 'gemini');

  it('opens a visible terminal on Windows, kept open so a failure can be read', () => {
    const launch = signInLaunchFor(claude, 'win32');

    expect(launch?.command).toBe('cmd.exe');
    expect(launch?.args).toContain('/k');
    expect(launch?.args.at(-1)).toBe('claude login');
    // Without an empty title `start` reads the next quoted argument as one.
    expect(launch?.args[2]).toBe('""');
  });

  it('drives Terminal through osascript on macOS', () => {
    const launch = signInLaunchFor(claude, 'darwin');

    expect(launch?.command).toBe('osascript');
    expect(launch?.args.join(' ')).toContain('claude login');
  });

  it('reaches for a terminal emulator on Linux', () => {
    const launch = signInLaunchFor(claude, 'linux');

    expect(LINUX_TERMINALS).toContain(launch?.command);
    expect(launch?.args).toEqual(['-e', 'claude login']);
  });

  /// Checked against the installed CLI: its help lists `mcp`, `extensions`,
  /// `skills`, `hooks` and `gemma`, and no `login`. It authenticates on its
  /// first interactive launch, so running it *is* the sign-in.
  it('signs in to Gemini by running it, since it has no login subcommand', () => {
    expect(gemini?.signIn).toBe('gemini');
    expect(signInLaunchFor(gemini, 'win32')?.args.at(-1)).toBe('gemini');
  });

  it('has nothing to start for an agent that declares no sign-in', () => {
    const nothing = { id: 'gemini' as const, label: 'X', command: 'x', install: 'x', docs: 'x' };
    expect(signInLaunchFor(nothing, 'win32')).toBeNull();
  });

  /**
   * The agent settings row diagnosed "Needs Sign-in" and offered no way to
   * sign in, because nothing connected that row to this catalogue. Matched on
   * the resolved binary: the display name is translated and a custom row can
   * set it to anything.
   */
  it('finds the agent a settings row is about, by its command', () => {
    expect(connectableAgentForCommand('gemini')?.id).toBe('gemini');
    expect(connectableAgentForCommand('claude.exe')?.id).toBe('claude-code');
    expect(connectableAgentForCommand('CODEX.CMD')?.id).toBe('codex');
  });

  it('knows no sign-in for a row that is not one of these', () => {
    expect(connectableAgentForCommand('my-own-agent')).toBeNull();
    expect(connectableAgentForCommand('')).toBeNull();
    expect(connectableAgentForCommand(undefined)).toBeNull();
  });

  it('finds an agent by the id the panel holds, and refuses an unknown one', () => {
    expect(connectableAgent('claude-code')?.label).toBe('Claude Code');
    expect(connectableAgent('nothing-like-this')).toBeNull();
  });
});
