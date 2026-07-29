/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { httpRequest } from '@/common/adapter/httpBridge';
import type { IProvider } from '@/common/config/storage';
import {
  isLmStudioProvider,
  mergeModelIds,
  resolveLmStudioModels,
  type LmStudioSourceDeps,
  type ModelListTier,
} from './LmStudioModelSource';

const OLLAMA_URL = 'http://127.0.0.1:11434';
const LM_STUDIO_URL = 'http://127.0.0.1:1234';
const REACHABILITY_TIMEOUT_MS = 2000;

async function isUrlReachable(url: string, path: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);
    const response = await fetch(`${url}${path}`, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

async function addProviderIfNotExists(
  existingProviders: IProvider[],
  platform: string,
  name: string,
  baseUrl: string,
  apiKey: string = 'sk-local'
): Promise<void> {
  const exists = existingProviders.some(
    (provider) => provider.platform === platform || provider.base_url.startsWith(baseUrl)
  );
  if (exists) return;

  try {
    await httpRequest('POST', '/api/providers', {
      platform,
      name,
      base_url: baseUrl,
      api_key: apiKey,
      enabled: true,
    });
    console.info(`[LocalModels] Registered local provider: ${name}`);
  } catch (error) {
    console.error(`[LocalModels] Failed to register local provider ${name}:`, error);
  }
}

/**
 * Registers reachable local inference hosts as providers.
 *
 * Ollama's `/api/tags` already lists every pulled model, so it needs no model
 * publication step. LM Studio's OpenAI-compatible `/v1/models` lists only
 * loaded models, which is what {@link publishLmStudioModels} corrects.
 */
export async function discoverAndRegisterLocalProviders(): Promise<void> {
  try {
    const existingProviders = (await httpRequest<IProvider[]>('GET', '/api/providers')) || [];

    if (await isUrlReachable(OLLAMA_URL, '/api/tags')) {
      await addProviderIfNotExists(existingProviders, 'ollama', 'Ollama (Local)', OLLAMA_URL);
    }

    if (await isUrlReachable(LM_STUDIO_URL, '/v1/models')) {
      await addProviderIfNotExists(existingProviders, 'openai', 'LM Studio (Local)', `${LM_STUDIO_URL}/v1`);
    }
  } catch (error) {
    console.error('[LocalModels] Local provider discovery failed:', error);
  }
}

export type PublishResult = { tier: ModelListTier; updatedProviderIds: string[] };

/**
 * Writes the complete installed-model list into every matching LM Studio
 * provider record.
 *
 * A discovery failure returns without touching the stored list: an empty result
 * must never be mistaken for "no models installed" and clear a working picker.
 */
export async function publishLmStudioModels(deps: {
  source: LmStudioSourceDeps;
  port: number;
  listProviders: () => Promise<IProvider[]>;
  updateProvider: (id: string, models: string[]) => Promise<void>;
}): Promise<PublishResult> {
  const providers = await deps.listProviders();
  const targets = providers.filter((provider) => isLmStudioProvider(provider.base_url, deps.port));
  if (targets.length === 0) return { tier: 'unavailable', updatedProviderIds: [] };

  const { tier, models } = await resolveLmStudioModels(deps.source);
  if (models.length === 0) return { tier, updatedProviderIds: [] };

  const updatedProviderIds: string[] = [];
  for (const provider of targets) {
    const current = provider.models ?? [];
    const merged = mergeModelIds(current, models);
    if (merged.length === current.length) continue;

    await deps.updateProvider(provider.id, merged);
    updatedProviderIds.push(provider.id);
  }

  return { tier, updatedProviderIds };
}
