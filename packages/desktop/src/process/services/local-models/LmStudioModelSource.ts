/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelListTier } from '@/common/types/provider/localModels';
import type { LocalModelEntry } from './lmsCli';

export type { ModelListTier };

export type ModelListResult = { tier: ModelListTier; models: LocalModelEntry[] };

export type LmStudioSourceDeps = {
  readCli: () => Promise<LocalModelEntry[] | null>;
  scanDir: (root: string) => Promise<LocalModelEntry[] | null>;
  readHttp: () => Promise<LocalModelEntry[] | null>;
  modelsRoot: () => Promise<string | null>;
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Resolves the installed model list through three tiers, stopping at the first
 * one that answers. Each tier returns `null` when it cannot answer, which is
 * deliberately distinct from returning an empty list.
 */
export const resolveLmStudioModels = async (deps: LmStudioSourceDeps): Promise<ModelListResult> => {
  const fromCli = await deps.readCli();
  if (fromCli) return { tier: 'complete', models: fromCli };

  const root = await deps.modelsRoot();
  if (root) {
    const fromDir = await deps.scanDir(root);
    if (fromDir) return { tier: 'complete-degraded', models: fromDir };
  }

  const fromHttp = await deps.readHttp();
  if (fromHttp) return { tier: 'loaded-only', models: fromHttp };

  return { tier: 'unavailable', models: [] };
};

/**
 * LM Studio is registered as a generic `openai` provider, so platform is not a
 * usable signal. Match on a loopback host plus the configured server port.
 */
export const isLmStudioProvider = (baseUrl: string, port: number): boolean => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }

  return LOOPBACK_HOSTS.has(url.hostname) && url.port === String(port);
};

/**
 * Unions discovery results with whatever the backend already returned, so a
 * currently loaded model can never drop out of the picker.
 */
export const mergeModelIds = (backendModels: readonly string[], discovered: readonly LocalModelEntry[]): string[] =>
  [...new Set([...backendModels, ...discovered.map((model) => model.id)])].toSorted();
