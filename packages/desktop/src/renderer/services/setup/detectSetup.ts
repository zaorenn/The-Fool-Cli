/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { CONNECTABLE_AGENTS, type AgentPresence, type ConnectableAgentId } from '@/common/config/connectableAgents';
import {
  LOCAL_GATEWAYS,
  probeUrlFor,
  stateFor,
  type GatewayState,
  type LocalGatewayId,
} from '@/common/config/localGateways';

/**
 * Looking at the machine before asking the user anything.
 *
 * The setup panel's whole promise is that it already knows what is here — the
 * coding agent is usually installed, the gateway is usually running, and being
 * asked to describe either is being asked to do it twice. This is the looking.
 *
 * Everything is probed at once and nothing is allowed to fail loudly. A panel
 * that takes six seconds because one dead port is being waited on serially is a
 * panel people close, and a probe that throws takes the whole list with it.
 */

/** Long enough for something that is listening, short enough not to be felt. */
const PROBE_TIMEOUT_MS = 1_500;

/**
 * Whether a gateway answers, and how many models it has.
 *
 * Deliberately tolerant about the shape: these are three different projects
 * implementing the same endpoint, and a `data` array is the only part they all
 * agree on. Anything unreadable counts as running-but-empty rather than absent,
 * because something answered — telling the user to install what is already
 * there is the worse mistake.
 */
const probeGateway = async (url: string): Promise<{ reachable: boolean; models: number }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { reachable: false, models: 0 };

    const body = (await response.json()) as { data?: unknown };
    return { reachable: true, models: Array.isArray(body.data) ? body.data.length : 0 };
  } catch {
    return { reachable: false, models: 0 };
  } finally {
    clearTimeout(timer);
  }
};

export const detectGateways = async (): Promise<Map<LocalGatewayId, GatewayState>> => {
  const found = new Map<LocalGatewayId, GatewayState>();
  await Promise.all(
    LOCAL_GATEWAYS.map(async (gateway) => {
      const { reachable, models } = await probeGateway(probeUrlFor(gateway));
      found.set(gateway.id, stateFor(reachable, models));
    })
  );
  return found;
};

/**
 * Which coding agents are on PATH.
 *
 * Sign-in is left unknown on purpose. There is no cheap, reliable way to ask a
 * CLI whether it holds a credential without running it, and running somebody's
 * agent to find out is both slow and rude — so the panel offers "use this" and
 * a failure that says why, rather than a sign-in screen in front of somebody
 * who is already signed in.
 */
export const detectAgents = async (): Promise<Map<ConnectableAgentId, AgentPresence>> => {
  const found = new Map<ConnectableAgentId, AgentPresence>();
  await Promise.all(
    CONNECTABLE_AGENTS.map(async (agent) => {
      try {
        const installed = await ipcBridge.shell.checkToolInstalled.invoke({ tool: agent.command });
        found.set(agent.id, { installed: Boolean(installed) });
      } catch {
        // An unreachable backend is not evidence the agent is missing, but it
        // is the only answer available — and "install it" is recoverable,
        // where hiding the row is not.
        found.set(agent.id, { installed: false });
      }
    })
  );
  return found;
};

export type SetupSnapshot = {
  agents: Map<ConnectableAgentId, AgentPresence>;
  gateways: Map<LocalGatewayId, GatewayState>;
};

/** Both halves, together, in one wait rather than two. */
export const detectSetup = async (): Promise<SetupSnapshot> => {
  const [agents, gateways] = await Promise.all([detectAgents(), detectGateways()]);
  return { agents, gateways };
};
