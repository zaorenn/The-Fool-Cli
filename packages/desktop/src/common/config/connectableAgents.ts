/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The agents someone can connect, and how far along they already are.
 *
 * Connecting Claude Code, Codex or Gemini currently means a conversation with
 * the setup agent, which works and is far too much ceremony for something most
 * people have already done: the CLI is usually installed, and usually signed in.
 * Asking them to describe that to an assistant is asking them to redo it.
 *
 * So the app looks first. What it finds decides which of three things the panel
 * offers, and none of them is a form:
 *
 *  - installed and signed in → one button, "use this"
 *  - installed, not signed in → one button that runs the CLI's own sign-in
 *  - not installed → the install command, copyable, with what it will do
 *
 * The catalogue is data rather than a switch statement because the interesting
 * part is per-agent and small, and because adding one should be adding a row.
 */

export type ConnectableAgentId = 'claude-code' | 'codex' | 'gemini';

export type ConnectableAgent = {
  id: ConnectableAgentId;
  /** What the vendor calls it, shown as-is. */
  label: string;
  /** The executable to look for on PATH. */
  command: string;
  /** How somebody installs it, shown when it is missing. */
  install: string;
  /** What the CLI's own sign-in is, when it has one. */
  signIn?: string;
  /** Where to read about it, for anyone who wants to before installing. */
  docs: string;
};

export const CONNECTABLE_AGENTS: readonly ConnectableAgent[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    command: 'claude',
    install: 'npm install -g @anthropic-ai/claude-code',
    signIn: 'claude login',
    docs: 'https://docs.claude.com/en/docs/claude-code',
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    install: 'npm install -g @openai/codex',
    signIn: 'codex login',
    docs: 'https://developers.openai.com/codex',
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    command: 'gemini',
    install: 'npm install -g @google/gemini-cli',
    docs: 'https://github.com/google-gemini/gemini-cli',
  },
];

/** What was found on the machine for one agent. */
export type AgentPresence = {
  installed: boolean;
  /** Whether a credential was found. Unknown for an agent with no sign-in step. */
  signedIn?: boolean;
};

/**
 * The single thing the panel should offer for this agent.
 *
 * One action, never a choice between two — a person who has not connected a
 * coding agent before cannot rank "sign in" against "install", and being shown
 * both is how a two-click job becomes a support question.
 */
export type ConnectStep = 'use' | 'sign-in' | 'install';

export const nextStepFor = (agent: ConnectableAgent, presence: AgentPresence): ConnectStep => {
  if (!presence.installed) return 'install';
  // An agent with no sign-in of its own is ready the moment it is on the
  // machine; asking it to sign in would send the user looking for a command
  // that does not exist.
  if (!agent.signIn) return 'use';
  return presence.signedIn === false ? 'sign-in' : 'use';
};

/**
 * The agents worth putting in front of somebody, most-ready first.
 *
 * Ready ones lead because the whole point is that the common case is already
 * done and needs one click. Missing ones come last rather than being hidden:
 * somebody with none installed still has to be told what to install.
 */
export const orderForSetup = (
  found: ReadonlyMap<ConnectableAgentId, AgentPresence>,
  agents: readonly ConnectableAgent[] = CONNECTABLE_AGENTS
): { agent: ConnectableAgent; step: ConnectStep }[] => {
  const rank: Record<ConnectStep, number> = { use: 0, 'sign-in': 1, install: 2 };

  return agents
    .map((agent) => ({ agent, step: nextStepFor(agent, found.get(agent.id) ?? { installed: false }) }))
    .toSorted((a, b) => rank[a.step] - rank[b.step]);
};

/** Whether anything at all is ready, so the panel knows if it can be skipped. */
export const hasReadyAgent = (found: ReadonlyMap<ConnectableAgentId, AgentPresence>): boolean =>
  orderForSetup(found).some((entry) => entry.step === 'use');
