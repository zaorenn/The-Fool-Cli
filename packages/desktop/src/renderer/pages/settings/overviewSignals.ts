/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The same "what's wrong" signals `foolcore diagnose overview` computes for
 * the Jester, read here from the same five endpoints so a person looking at
 * Settings sees exactly what the agent sees when asked to check.
 *
 * Deliberately not shared code with `cmd_diagnose.rs` — that CLI runs as a
 * separate process with no access to this app's TypeScript, and duplicating
 * five small predicates costs far less than a cross-language shared module
 * would. Keep the two in step by hand if either changes.
 */

export type ProviderModelHealth = { status?: string; error?: string | null };

export type ProviderRow = {
  id?: string;
  name?: string;
  model_health?: Record<string, ProviderModelHealth>;
};

export type UnhealthyModel = { provider: string; model: string; status: string; error: string | null };

export type ProviderSummary = { total: number; unhealthy: UnhealthyModel[] };

/** A provider with no `model_health` at all has not been checked, not failed — never counted as unhealthy. */
export const summarizeProviders = (providers: readonly ProviderRow[]): ProviderSummary => {
  const unhealthy: UnhealthyModel[] = [];
  for (const provider of providers) {
    for (const [model, health] of Object.entries(provider.model_health ?? {})) {
      if (health.status && health.status !== 'healthy') {
        unhealthy.push({
          provider: provider.name ?? provider.id ?? '',
          model,
          status: health.status,
          error: health.error ?? null,
        });
      }
    }
  }
  return { total: providers.length, unhealthy };
};

export type McpServerRow = { id?: string; name?: string; enabled?: boolean; tools?: unknown };

export type McpFlag = { id: string; name: string };

export type McpSummary = { total: number; enabledButNoTools: McpFlag[] };

const toolCount = (server: McpServerRow): number => {
  if (Array.isArray(server.tools)) return server.tools.length;
  if (typeof server.tools === 'number') return server.tools;
  return 0;
};

/** A disabled server is expected to have no tools; only an enabled one with none is a symptom. */
export const summarizeMcp = (servers: readonly McpServerRow[]): McpSummary => ({
  total: servers.length,
  enabledButNoTools: servers
    .filter((server) => server.enabled === true && toolCount(server) === 0)
    .map((server) => ({ id: server.id ?? '', name: server.name ?? server.id ?? '' })),
});

export type CronJobRow = { id?: string; name?: string; last_status?: string; last_error?: string | null };

export type CronFlag = { id: string; name: string; lastStatus: string; lastError: string | null };

export type CronSummary = { total: number; failing: CronFlag[] };

export const summarizeCron = (jobs: readonly CronJobRow[]): CronSummary => ({
  total: jobs.length,
  failing: jobs
    .filter((job) => job.last_status === 'error' || job.last_status === 'missed')
    .map((job) => ({
      id: job.id ?? '',
      name: job.name ?? job.id ?? '',
      lastStatus: job.last_status ?? '',
      lastError: job.last_error ?? null,
    })),
});

export type ConversationRow = {
  id?: string;
  name?: string;
  status?: string;
  runtime?: { state?: string } | null;
};

export type ConversationFlag = { id: string; name: string };

/** Either shape counts as running: the persisted `status` or the live `runtime.state`. */
export const summarizeRunningConversations = (conversations: readonly ConversationRow[]): ConversationFlag[] =>
  conversations
    .filter((conversation) => conversation.status === 'running' || conversation.runtime?.state === 'running')
    .map((conversation) => ({ id: conversation.id ?? '', name: conversation.name ?? conversation.id ?? '' }));
