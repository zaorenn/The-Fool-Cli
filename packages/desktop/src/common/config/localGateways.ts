/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OpenAI-compatible endpoints already running on the user's own machine.
 *
 * There is a growing family of these — a model server, a router, a gateway —
 * and from this app's side they are the same thing: a base URL that answers
 * `/models` and takes chat completions. What differs is the port, the name to
 * show, and what to say when nothing answers.
 *
 * Written as a table because that is all the variation there is, and because
 * the failure this prevents is asking somebody to find and type
 * `http://localhost:20128/v1` — a string nobody can be expected to know and
 * which is wrong in a way that produces no error, just a provider that never
 * lists a model.
 */

export type LocalGatewayId = 'lm-studio' | 'omniroute' | 'ollama';

export type LocalGateway = {
  id: LocalGatewayId;
  label: string;
  /** The OpenAI-compatible base, as the app should store it. */
  baseUrl: string;
  /** One line on what it is, for somebody who has not heard of it. */
  what: string;
  /** How to get it, shown when nothing is answering on its port. */
  install: string;
  docs: string;
  /**
   * Whether it needs a key.
   *
   * All three are local and take anything, but a provider row with an empty key
   * field looks broken — so a placeholder is stored rather than nothing.
   */
  placeholderKey: string;
};

export const LOCAL_GATEWAYS: readonly LocalGateway[] = [
  {
    id: 'lm-studio',
    label: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    what: 'Runs a model on your own machine. Nothing leaves the computer.',
    install: 'Download from lmstudio.ai, then load a model and start its server.',
    docs: 'https://lmstudio.ai',
    placeholderKey: 'lm-studio',
  },
  {
    id: 'omniroute',
    label: 'OmniRoute',
    baseUrl: 'http://127.0.0.1:20128/v1',
    // Its point, in the user's terms: a chain of free models that fails over
    // when one runs out of quota, behind a single endpoint.
    what: 'Routes one endpoint across many providers, including free tiers, falling over when a quota runs out.',
    install: 'npm install -g omniroute && omniroute',
    docs: 'https://github.com/ChrisCompton/omniroute',
    placeholderKey: 'omniroute',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    what: 'Runs a model on your own machine, from the command line.',
    install: 'Download from ollama.com, then `ollama pull` a model.',
    docs: 'https://ollama.com',
    placeholderKey: 'ollama',
  },
];

export const gatewayById = (id: LocalGatewayId): LocalGateway | undefined =>
  LOCAL_GATEWAYS.find((gateway) => gateway.id === id);

/** The address whose `/models` should be asked whether this gateway is up. */
export const probeUrlFor = (gateway: LocalGateway): string => `${gateway.baseUrl.replace(/\/+$/, '')}/models`;

export type GatewayState = 'ready' | 'running-empty' | 'absent';

/**
 * What was found at one gateway's port, as a single word.
 *
 * `running-empty` is worth separating from `absent` because it is the most
 * common way this goes wrong and the two need opposite advice: a gateway that
 * is up with no models means "load one", and one that is down means "install
 * it". Told the wrong one, somebody reinstalls software they already have.
 */
export const stateFor = (reachable: boolean, modelCount: number): GatewayState => {
  if (!reachable) return 'absent';
  return modelCount > 0 ? 'ready' : 'running-empty';
};

/**
 * The gateways worth offering, the usable ones first.
 *
 * Same rule as everywhere else in setup: what already works leads, and what is
 * missing stays visible rather than being hidden from somebody who has none of
 * them yet.
 */
export const orderGateways = (
  found: ReadonlyMap<LocalGatewayId, GatewayState>,
  gateways: readonly LocalGateway[] = LOCAL_GATEWAYS
): { gateway: LocalGateway; state: GatewayState }[] => {
  const rank: Record<GatewayState, number> = { ready: 0, 'running-empty': 1, absent: 2 };

  return gateways
    .map((gateway) => ({ gateway, state: found.get(gateway.id) ?? 'absent' }))
    .toSorted((a, b) => rank[a.state] - rank[b.state]);
};
