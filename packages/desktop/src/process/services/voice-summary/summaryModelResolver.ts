/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider } from '@/common/config/storage';
import type { VoiceSummaryModelOrigin } from '@/common/types/foolVoice';
import { isChatCapableModel } from '@/common/utils/modelCapabilities';

export { isChatCapableModel } from '@/common/utils/modelCapabilities';

/** An OpenAI-compatible chat endpoint a summary can be asked of. */
export type SummaryEndpoint = {
  modelId: string;
  displayName: string;
  /** Base URL including the version segment, no trailing slash. */
  baseUrl: string;
  /** Empty when the host wants no key, as local hosts generally do. */
  apiKey: string;
  /** True when the model runs on this machine. */
  local: boolean;
};

export type SummaryPlan = {
  endpoint: SummaryEndpoint | null;
  /** False when the host still has to load the weights, which takes a while. */
  loaded: boolean;
  origin: VoiceSummaryModelOrigin;
};

export type SummaryModelInput = {
  /** Pinned in Voice settings. Empty means choose automatically. */
  configuredModelId: string;
  /** The model that last produced a summary. Empty when there has not been one. */
  lastUsedModelId: string;
  /** The app's stored provider records, used for remote endpoints and keys. */
  providers: readonly IProvider[];
  lmStudioPort: number;
  /** Models the local host will answer for right now. */
  loadedLocalModelIds: readonly string[];
  /** Every model installed locally, loaded or not. */
  installedLocalModelIds: readonly string[];
};

/** Platforms whose wire protocol is not OpenAI chat completions. */
const NON_OPENAI_PLATFORMS = new Set(['anthropic', 'bedrock', 'gemini', 'gemini-vertex-ai']);

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const localEndpoint = (modelId: string, port: number): SummaryEndpoint => ({
  modelId,
  displayName: modelId.split('/').pop() || modelId,
  baseUrl: `http://127.0.0.1:${port}/v1`,
  apiKey: '',
  local: true,
});

const isLocalBaseUrl = (baseUrl: string): boolean => {
  try {
    return LOOPBACK_HOSTS.has(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
};

const providerEndpoint = (provider: IProvider, modelId: string): SummaryEndpoint => ({
  modelId,
  displayName: `${modelId} · ${provider.name}`,
  baseUrl: trimTrailingSlash(provider.base_url),
  apiKey: provider.api_key ?? '',
  local: isLocalBaseUrl(provider.base_url),
});

const usableProviders = (providers: readonly IProvider[]): IProvider[] =>
  providers.filter(
    (provider) =>
      provider.enabled !== false &&
      !NON_OPENAI_PLATFORMS.has(provider.platform) &&
      /^https?:\/\//.test(provider.base_url ?? '')
  );

/** Locates a named model, preferring the local host over a configured provider. */
const locate = (modelId: string, input: SummaryModelInput): { endpoint: SummaryEndpoint; loaded: boolean } | null => {
  if (!isChatCapableModel(modelId)) return null;

  if (input.loadedLocalModelIds.includes(modelId)) {
    return { endpoint: localEndpoint(modelId, input.lmStudioPort), loaded: true };
  }
  if (input.installedLocalModelIds.includes(modelId)) {
    return { endpoint: localEndpoint(modelId, input.lmStudioPort), loaded: false };
  }

  for (const provider of usableProviders(input.providers)) {
    if (!(provider.models ?? []).includes(modelId)) continue;
    if (provider.model_enabled?.[modelId] === false) continue;
    // A remote endpoint has no weights to load, so it is ready by definition.
    return { endpoint: providerEndpoint(provider, modelId), loaded: true };
  }

  return null;
};

/**
 * Chooses which model turns a reply into a spoken English briefing.
 *
 * Local first, and deliberately so: this runs on every spoken answer, and the
 * thing being summarised is whatever the assistant just said. A remote endpoint
 * is only ever used when the user named it themselves in settings — an unasked-for
 * cloud call with the contents of the user's conversation is not a default worth
 * having, however good the summary would be.
 *
 * Within local models, one that is already loaded wins over one that is merely
 * installed, because loading half a gigabyte of weights adds tens of seconds to
 * the first answer.
 */
export const resolveSummaryModel = (input: SummaryModelInput): SummaryPlan => {
  const explicit = input.configuredModelId.trim();
  if (explicit.length > 0) {
    const found = locate(explicit, input);
    // A pinned model that has since been removed falls through rather than
    // silencing speech: the automatic choice below is still better than nothing.
    if (found) return { ...found, origin: 'configured' };
  }

  const loaded = input.loadedLocalModelIds.find(isChatCapableModel);
  if (loaded) {
    return { endpoint: localEndpoint(loaded, input.lmStudioPort), loaded: true, origin: 'loaded' };
  }

  const lastUsed = input.lastUsedModelId.trim();
  if (lastUsed.length > 0 && lastUsed !== explicit) {
    const found = locate(lastUsed, input);
    if (found) return { ...found, origin: 'last-used' };
  }

  const installed = input.installedLocalModelIds.find(isChatCapableModel);
  if (installed) {
    return { endpoint: localEndpoint(installed, input.lmStudioPort), loaded: false, origin: 'installed' };
  }

  return { endpoint: null, loaded: false, origin: 'none' };
};
