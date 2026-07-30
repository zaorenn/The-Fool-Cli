/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { httpRequest } from '@/common/adapter/httpBridge';
import type { IProvider } from '@/common/config/storage';
import type {
  VoiceSummarizeRequest,
  VoiceSummarizeResponse,
  VoiceSummaryPlanRequest,
  VoiceSummaryPlanResponse,
} from '@/common/types/foolVoice';
import { readLmStudioInventory } from '../local-models';
import { summarizeToEnglish } from './EnglishSummarizer';
import { resolveSummaryModel, type SummaryModelInput, type SummaryPlan } from './summaryModelResolver';

export { cleanSummaryOutput, looksEnglish, summarizeToEnglish } from './EnglishSummarizer';
export { isChatCapableModel, resolveSummaryModel } from './summaryModelResolver';
export type { SummaryEndpoint, SummaryPlan } from './summaryModelResolver';

/**
 * The main-process half of the spoken English briefing.
 *
 * Two endpoints rather than one: the renderer asks which model would answer
 * *before* it asks for the answer, because a local model that is installed but
 * not loaded takes tens of seconds on its first request. Knowing that in advance
 * is what lets the pet say "waking the model" instead of looking frozen.
 */

const readProviders = async (): Promise<IProvider[]> => {
  try {
    return (await httpRequest<IProvider[]>('GET', '/api/providers')) || [];
  } catch {
    // No provider list means local models only, which is the intended default
    // anyway; it must not stop a summary from happening.
    return [];
  }
};

const buildInput = async (request: VoiceSummaryPlanRequest): Promise<SummaryModelInput> => {
  const [inventory, providers] = await Promise.all([readLmStudioInventory(), readProviders()]);
  return {
    configuredModelId: request.modelId,
    lastUsedModelId: request.lastUsedModelId,
    providers,
    lmStudioPort: inventory.port,
    loadedLocalModelIds: inventory.loaded,
    installedLocalModelIds: inventory.installed,
  };
};

const plan = async (request: VoiceSummaryPlanRequest): Promise<SummaryPlan> =>
  resolveSummaryModel(await buildInput(request));

export const handleSummaryPlan = async (request: VoiceSummaryPlanRequest): Promise<VoiceSummaryPlanResponse> => {
  const resolved = await plan(request);
  return {
    modelId: resolved.endpoint?.modelId ?? '',
    displayName: resolved.endpoint?.displayName ?? '',
    loaded: resolved.loaded,
    local: resolved.endpoint?.local ?? false,
    origin: resolved.origin,
  };
};

export const handleSummarize = async (request: VoiceSummarizeRequest): Promise<VoiceSummarizeResponse> => {
  const resolved = await plan({ modelId: request.modelId, lastUsedModelId: '' });
  if (!resolved.endpoint) {
    return {
      operationId: request.operationId,
      text: request.text,
      modelId: '',
      source: 'original',
      translated: false,
      reason: 'no-model',
    };
  }

  const outcome = await summarizeToEnglish({
    endpoint: resolved.endpoint,
    text: request.text,
    maxCharacters: request.maxCharacters,
    timeoutMs: request.timeoutMs,
  });

  // `=== false` rather than `!ok`: this project does not run with
  // strictNullChecks, and truthiness alone does not narrow the union.
  if (outcome.ok === false) {
    console.warn(`[FoolVoice] summary via ${resolved.endpoint.modelId} failed: ${outcome.failure}`);
    return {
      operationId: request.operationId,
      // Falling back to the reply itself is the honest answer: it is spoken in
      // the language it was written in rather than silently dropped.
      text: request.text,
      modelId: resolved.endpoint.modelId,
      source: 'original',
      translated: false,
      reason: outcome.failure,
    };
  }

  if (!outcome.translated) {
    console.warn(`[FoolVoice] ${resolved.endpoint.modelId} summarised but did not translate; speaking it anyway`);
  }

  return {
    operationId: request.operationId,
    text: outcome.text,
    modelId: resolved.endpoint.modelId,
    source: 'model',
    translated: outcome.translated,
  };
};
