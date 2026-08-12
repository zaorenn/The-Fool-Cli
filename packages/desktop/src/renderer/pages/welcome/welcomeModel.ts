/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the first screen offers, chosen from what is already on the machine.
 *
 * The backend seeds a catalogue of around thirty agents and resolves each one on
 * `$PATH` at startup, so by the time this page renders the app already knows
 * which of them the user has. The wizard used to name two of them — Codex and
 * Claude — and everything else that was found and working sat behind a settings
 * page nobody had opened yet.
 *
 * So the question this file answers is not "which two do we recommend" but "what
 * did we find, and in what order should somebody see it". The order is the whole
 * design: something already signed in is one click away from working, and that
 * has to come first; something installed but not signed in is a short detour;
 * something missing is a download, and belongs last or not at all.
 */

import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

export type OnboardingStatus = 'unavailable' | 'missing' | 'connected' | 'needs-auth' | 'ready-to-check';

export const getOnboardingStatus = (agent: ManagedAgent | undefined): OnboardingStatus => {
  if (!agent) return 'unavailable';
  if (agent.status === 'missing') return 'missing';
  if (agent.status === 'online') return 'connected';
  if (agent.status === 'offline') return 'needs-auth';
  return 'ready-to-check';
};

/** Best first. Anything already working, then anything installed, then the rest. */
const RANK: Record<OnboardingStatus, number> = {
  connected: 0,
  'ready-to-check': 1,
  'needs-auth': 2,
  missing: 3,
  unavailable: 4,
};

/**
 * How many cards the step shows.
 *
 * Six fits three across on two rows at every width this page supports, and a
 * first screen is not a catalogue — the rest are a click away in settings, and
 * saying so is more honest than a wall of thirty logos.
 */
export const ONBOARDING_LIMIT = 6;

export type OnboardingChoice = {
  agent: ManagedAgent;
  status: OnboardingStatus;
};

/**
 * The agents worth offering, ordered.
 *
 * Only ones the user could actually pick: an agent they have switched off is an
 * answer they already gave, and a row with no backend is not something a person
 * recognises by name.
 *
 * Ties are broken by name rather than left to the order the backend happened to
 * return, so the same machine shows the same screen twice.
 */
export const onboardingChoices = (agents: readonly ManagedAgent[]): OnboardingChoice[] =>
  agents
    .filter((agent) => agent.enabled !== false && Boolean(agent.backend))
    .map((agent) => ({ agent, status: getOnboardingStatus(agent) }))
    .filter((choice) => choice.status !== 'unavailable')
    .sort((left, right) => RANK[left.status] - RANK[right.status] || left.agent.name.localeCompare(right.agent.name));

/**
 * Whether anything found is ready to use without a detour.
 *
 * Drives the copy under the cards: with nothing connected, the honest thing to
 * say is that the assistant will help set one up, not that everything is ready.
 */
export const hasConnectedAgent = (choices: readonly OnboardingChoice[]): boolean =>
  choices.some((choice) => choice.status === 'connected');
