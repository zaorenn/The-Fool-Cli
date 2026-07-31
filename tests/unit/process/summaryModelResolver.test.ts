/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import {
  isChatCapableModel,
  resolveSummaryModel,
  type SummaryModelInput,
} from '@process/services/voice-summary/summaryModelResolver';

const provider = (overrides: Partial<IProvider> = {}): IProvider => ({
  id: 'p1',
  platform: 'openai',
  name: 'Somewhere Remote',
  base_url: 'https://api.example.com/v1',
  api_key: 'sk-remote',
  models: ['gpt-4o-mini'],
  ...overrides,
});

const input = (overrides: Partial<SummaryModelInput> = {}): SummaryModelInput => ({
  configuredModelId: '',
  lastUsedModelId: '',
  providers: [],
  lmStudioPort: 1234,
  loadedLocalModelIds: [],
  installedLocalModelIds: [],
  ...overrides,
});

describe('resolveSummaryModel', () => {
  it('prefers a local model that is already loaded over one that only exists', () => {
    const plan = resolveSummaryModel(
      input({
        loadedLocalModelIds: ['qwen3-4b'],
        installedLocalModelIds: ['gemma-3-27b', 'qwen3-4b'],
      })
    );

    expect(plan.origin).toBe('loaded');
    expect(plan.loaded).toBe(true);
    expect(plan.endpoint).toMatchObject({
      modelId: 'qwen3-4b',
      baseUrl: 'http://127.0.0.1:1234/v1',
      apiKey: '',
      local: true,
    });
  });

  it('falls back to an installed model and reports that it still has to load', () => {
    const plan = resolveSummaryModel(input({ installedLocalModelIds: ['gemma-3-27b'] }));

    expect(plan.origin).toBe('installed');
    expect(plan.loaded).toBe(false);
    expect(plan.endpoint?.modelId).toBe('gemma-3-27b');
  });

  it('uses the port the local server was actually found on', () => {
    const plan = resolveSummaryModel(input({ loadedLocalModelIds: ['qwen3-4b'], lmStudioPort: 4891 }));

    expect(plan.endpoint?.baseUrl).toBe('http://127.0.0.1:4891/v1');
  });

  it('never reaches for a remote provider on its own', () => {
    // The thing being summarised is whatever the assistant just said. A cloud
    // call with that in it has to be asked for, not defaulted into.
    const plan = resolveSummaryModel(input({ providers: [provider()] }));

    expect(plan.origin).toBe('none');
    expect(plan.endpoint).toBeNull();
  });

  it('uses a remote provider when the user named its model in settings', () => {
    const plan = resolveSummaryModel(input({ configuredModelId: 'gpt-4o-mini', providers: [provider()] }));

    expect(plan.origin).toBe('configured');
    expect(plan.loaded).toBe(true);
    expect(plan.endpoint).toMatchObject({
      modelId: 'gpt-4o-mini',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-remote',
      local: false,
    });
  });

  it('drops the trailing slash a provider base URL may carry', () => {
    const plan = resolveSummaryModel(
      input({ configuredModelId: 'gpt-4o-mini', providers: [provider({ base_url: 'https://api.example.com/v1/' })] })
    );

    expect(plan.endpoint?.baseUrl).toBe('https://api.example.com/v1');
  });

  it('treats a configured model that is installed locally as needing a load', () => {
    const plan = resolveSummaryModel(
      input({ configuredModelId: 'gemma-3-27b', installedLocalModelIds: ['gemma-3-27b'] })
    );

    expect(plan.origin).toBe('configured');
    expect(plan.loaded).toBe(false);
  });

  it('falls through to the automatic choice when the pinned model has been removed', () => {
    // A stale pin must not silence speech; something installed is still better.
    const plan = resolveSummaryModel(
      input({ configuredModelId: 'a-model-that-was-deleted', loadedLocalModelIds: ['qwen3-4b'] })
    );

    expect(plan.origin).toBe('loaded');
    expect(plan.endpoint?.modelId).toBe('qwen3-4b');
  });

  it('remembers the last model used when nothing is loaded', () => {
    const plan = resolveSummaryModel(
      input({ lastUsedModelId: 'gemma-3-27b', installedLocalModelIds: ['aya-8b', 'gemma-3-27b'] })
    );

    expect(plan.origin).toBe('last-used');
    expect(plan.endpoint?.modelId).toBe('gemma-3-27b');
  });

  it('skips providers the user disabled', () => {
    const plan = resolveSummaryModel(
      input({ configuredModelId: 'gpt-4o-mini', providers: [provider({ enabled: false })] })
    );

    expect(plan.endpoint).toBeNull();
  });

  it('skips a model the user switched off inside an enabled provider', () => {
    const plan = resolveSummaryModel(
      input({
        configuredModelId: 'gpt-4o-mini',
        providers: [provider({ model_enabled: { 'gpt-4o-mini': false } })],
      })
    );

    expect(plan.endpoint).toBeNull();
  });

  it('ignores providers whose wire protocol is not OpenAI chat completions', () => {
    const plan = resolveSummaryModel(
      input({
        configuredModelId: 'claude-sonnet-4',
        providers: [provider({ platform: 'anthropic', models: ['claude-sonnet-4'] })],
      })
    );

    expect(plan.endpoint).toBeNull();
  });

  it('never picks an embedding or reranking model', () => {
    const plan = resolveSummaryModel(
      input({
        loadedLocalModelIds: ['text-embedding-nomic-embed-text-v1.5', 'bge-reranker-v2-m3', 'qwen3-4b'],
      })
    );

    expect(plan.endpoint?.modelId).toBe('qwen3-4b');
  });

  it('reports no model rather than guessing when the machine has none', () => {
    const plan = resolveSummaryModel(input());

    expect(plan).toEqual({ endpoint: null, loaded: false, origin: 'none' });
  });
});

describe('isChatCapableModel', () => {
  it.each(['qwen3-4b', 'gemma-3-27b-it', 'llama-3.1-8b-instruct', 'mistral-nemo'])('accepts %s', (id) => {
    expect(isChatCapableModel(id)).toBe(true);
  });

  it.each(['text-embedding-3-small', 'nomic-embed-text-v1.5', 'bge-reranker-large', 'jina-embeddings-v3'])(
    'rejects %s',
    (id) => {
      expect(isChatCapableModel(id)).toBe(false);
    }
  );
});
