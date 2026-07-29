/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import { publishLmStudioModels } from '@process/services/local-models/LocalProviderRegistrar';
import type { LmStudioSourceDeps } from '@process/services/local-models/LmStudioModelSource';

const entry = (id: string) => ({ id, displayName: id, contextLength: null, toolUse: false });

const provider = (over: Partial<IProvider> = {}): IProvider =>
  ({
    id: 'p1',
    platform: 'openai',
    name: 'LM Studio (Local)',
    base_url: 'http://127.0.0.1:1234/v1',
    api_key: 'sk-local',
    models: ['loaded-model'],
    ...over,
  }) as IProvider;

const source = (over: Partial<LmStudioSourceDeps> = {}): LmStudioSourceDeps => ({
  readCli: vi.fn().mockResolvedValue([entry('a'), entry('b')]),
  scanDir: vi.fn().mockResolvedValue(null),
  readHttp: vi.fn().mockResolvedValue(null),
  modelsRoot: vi.fn().mockResolvedValue(null),
  ...over,
});

describe('publishLmStudioModels', () => {
  it('writes the union of backend and discovered models', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined);

    const result = await publishLmStudioModels({
      source: source(),
      port: 1234,
      listProviders: async () => [provider()],
      updateProvider,
    });

    expect(updateProvider).toHaveBeenCalledWith('p1', ['a', 'b', 'loaded-model']);
    expect(result).toEqual({ tier: 'complete', updatedProviderIds: ['p1'] });
  });

  it('ignores providers that are not LM Studio', async () => {
    const updateProvider = vi.fn();

    const result = await publishLmStudioModels({
      source: source(),
      port: 1234,
      listProviders: async () => [provider({ base_url: 'https://api.openai.com/v1' })],
      updateProvider,
    });

    expect(updateProvider).not.toHaveBeenCalled();
    expect(result.updatedProviderIds).toEqual([]);
  });

  it('does not clear a known list when every discovery tier fails', async () => {
    const updateProvider = vi.fn();

    const result = await publishLmStudioModels({
      source: source({ readCli: vi.fn().mockResolvedValue(null) }),
      port: 1234,
      listProviders: async () => [provider()],
      updateProvider,
    });

    expect(updateProvider).not.toHaveBeenCalled();
    expect(result.tier).toBe('unavailable');
  });

  it('skips the write when the stored list is already complete', async () => {
    const updateProvider = vi.fn();

    await publishLmStudioModels({
      source: source(),
      port: 1234,
      listProviders: async () => [provider({ models: ['a', 'b'] })],
      updateProvider,
    });

    expect(updateProvider).not.toHaveBeenCalled();
  });

  it('handles a provider record with no models field', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined);

    await publishLmStudioModels({
      source: source(),
      port: 1234,
      listProviders: async () => [provider({ models: undefined as unknown as string[] })],
      updateProvider,
    });

    expect(updateProvider).toHaveBeenCalledWith('p1', ['a', 'b']);
  });

  it('matches the configured port rather than assuming 1234', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined);

    await publishLmStudioModels({
      source: source(),
      port: 4321,
      listProviders: async () => [provider({ base_url: 'http://127.0.0.1:4321/v1' })],
      updateProvider,
    });

    expect(updateProvider).toHaveBeenCalled();
  });
});
