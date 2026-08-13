/**
 * @license
 * Copyright 2025 The Fool (thefool.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Binds the SCM store to the shared WS singleton. SCM rides the same socket as
 * the explorer but on its **own outer envelope** (`name: "scm"`, routed to a
 * separate backend router) ÔÇö the two lanes are decoupled because their semantics
 * differ: `fs` is directory-subscription with deltas, `scm` is whole-frame status
 * replacement (protocol.md ┬ğµ║Éõ╗úáüµÄğÕêÂ).
 *
 * The JSON-RPC pairing itself is reused verbatim from {@link MonitorClient}; only
 * the envelope name and the notification sink differ. This is thin production
 * wiring ÔÇö the pairing core and the store logic each have their own unit tests.
 */

import { wsEmitter, wsSend } from '@/common/adapter/httpBridge';

import type { MonitorTransport } from '../explorer/monitorClient';
import { MonitorClient } from '../explorer/monitorClient';
import type { ScmActionKind, ScmRepository, ScmStatus } from './scmModel';
import {
  applyScmNotification,
  configureScmStore,
  onScmReconnect,
  type ScmActionResult,
  type ScmDiffResult,
} from './scmStore';

const SCM_EVENT = 'scm';
const RECONNECT_EVENT = 'realtime.reconnected';

/** Action ÔåÆ wire method. `discard` maps to `scm/discard` (revert on the engine side). */
const ACTION_METHOD: Record<ScmActionKind, string> = {
  stage: 'scm/stage',
  unstage: 'scm/unstage',
  discard: 'scm/discard',
};

/** Transport over the WS singleton: `scm` eventµùÅ in, `wsSend('scm', ÔÇĞ)` out. */
export function createWsScmTransport(): MonitorTransport {
  return {
    send: (frame) => wsSend(SCM_EVENT, frame),
    onFrame: (cb) => wsEmitter<unknown>(SCM_EVENT).on(cb),
    onReconnect: (cb) => wsEmitter(RECONNECT_EVENT).on(cb),
  };
}

let client: MonitorClient | null = null;

/**
 * Wire the SCM runtime once: a MonitorClient over the `scm` transport plus the
 * store's request port and notification/reconnect sinks. Idempotent ÔÇö safe to
 * call from every mount. Returns the shared client.
 */
export function initScmRuntime(): MonitorClient {
  if (client) return client;

  const scm = new MonitorClient({
    transport: createWsScmTransport(),
    onNotification: applyScmNotification,
    onReconnect: onScmReconnect,
  });
  client = scm;

  configureScmStore({
    listRepositories: async (projectId) =>
      (await scm.request('scm/listRepositories', { project_id: projectId })) as { repositories: ScmRepository[] },
    subscribe: async (repoIds) =>
      (await scm.request('scm/subscribe', { repositories: repoIds })) as { statuses: ScmStatus[] },
    unsubscribe: (repoIds) => {
      scm.notify('scm/unsubscribe', { repositories: repoIds });
    },
    status: async (repoId) => (await scm.request('scm/status', { repository: repoId })) as ScmStatus,
    diff: async (params) => (await scm.request('scm/diff', params)) as ScmDiffResult,
    // One method per action ÔÇö the wire has no "action" parameter, and that is what
    // makes a failure attributable to a side without a per-failure flag.
    act: async (action, params) => (await scm.request(ACTION_METHOD[action], params)) as ScmActionResult,
  });

  return scm;
}
