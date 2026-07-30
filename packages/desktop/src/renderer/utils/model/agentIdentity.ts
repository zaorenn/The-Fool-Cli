/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the agent that ships inside the app is called, and what it is called by.
 *
 * The two are not the same thing. The identifier is the wire value: it travels
 * in every conversation record and in the agent catalog, and the backend and this
 * app have to agree on it exactly. The name is what a user reads, and nothing
 * depends on it.
 *
 * The backend seeds a name of its own, and a migration corrects it there — this
 * resolver is the second layer, so the right name shows even before the catalog
 * has loaded.
 */

/** The backend's identifier for the built-in agent. Never shown to anyone. */
export const BUILT_IN_AGENT_BACKEND = 'foolrs';

/** What the user reads instead. */
export const BUILT_IN_AGENT_NAME = 'The Fool CLI';

export const isBuiltInAgent = (backend: string | undefined | null): boolean =>
  typeof backend === 'string' && backend.trim().toLowerCase() === BUILT_IN_AGENT_BACKEND;

/**
 * The name to put on screen for an agent.
 *
 * Falls back to the backend id for anything unrecognised, which is what the
 * badge did before — except for the built-in agent, where that fallback printed
 * the raw identifier at the user whenever the catalog had not loaded yet.
 */
export const resolveAgentDisplayName = (agentName: string | undefined | null, backend?: string | null): string => {
  if (isBuiltInAgent(backend)) return BUILT_IN_AGENT_NAME;

  const named = typeof agentName === 'string' ? agentName.trim() : '';
  if (named.length > 0) return named;

  return typeof backend === 'string' ? backend : '';
};
