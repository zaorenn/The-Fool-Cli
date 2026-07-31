/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { LocalModelEntry } from '@process/services/local-models/lmsCli';
import {
  isLmStudioProvider,
  mergeModelIds,
  resolveLmStudioModels,
  type LmStudioSourceDeps,
} from '@process/services/local-models/LmStudioModelSource';

const entry = (id: string): LocalModelEntry => ({ id, displayName: id, contextLength: null, toolUse: false });

const deps = (over: Partial<LmStudioSourceDeps> = {}): LmStudioSourceDeps => ({
  readCli: vi.fn().mockResolvedValue(null),
  scanDir: vi.fn().mockResolvedValue(null),
  readHttp: vi.fn().mockResolvedValue(null),
  modelsRoot: vi.fn().mockResolvedValue('/models'),
  ...over,
});

describe('resolveLmStudioModels', () => {
  it('reports tier complete when the cli answers', async () => {
    const result = await resolveLmStudioModels(deps({ readCli: vi.fn().mockResolvedValue([entry('a')]) }));

    expect(result).toEqual({ tier: 'complete', models: [entry('a')] });
  });

  it('falls back to the directory scan and reports complete-degraded', async () => {
    const result = await resolveLmStudioModels(deps({ scanDir: vi.fn().mockResolvedValue([entry('b')]) }));

    expect(result).toEqual({ tier: 'complete-degraded', models: [entry('b')] });
  });

  it('falls back to http and reports loaded-only', async () => {
    const result = await resolveLmStudioModels(deps({ readHttp: vi.fn().mockResolvedValue([entry('c')]) }));

    expect(result).toEqual({ tier: 'loaded-only', models: [entry('c')] });
  });

  it('skips the directory tier when no models root can be resolved', async () => {
    const scanDir = vi.fn().mockResolvedValue([entry('b')]);
    const result = await resolveLmStudioModels(
      deps({ scanDir, modelsRoot: vi.fn().mockResolvedValue(null), readHttp: vi.fn().mockResolvedValue([entry('c')]) })
    );

    expect(scanDir).not.toHaveBeenCalled();
    expect(result.tier).toBe('loaded-only');
  });

  it('reports unavailable with no models when every tier fails', async () => {
    expect(await resolveLmStudioModels(deps())).toEqual({ tier: 'unavailable', models: [] });
  });

  it('does not consult lower tiers once a higher tier answers', async () => {
    const dependencies = deps({ readCli: vi.fn().mockResolvedValue([entry('a')]) });

    await resolveLmStudioModels(dependencies);

    expect(dependencies.scanDir).not.toHaveBeenCalled();
    expect(dependencies.readHttp).not.toHaveBeenCalled();
  });
});

describe('isLmStudioProvider', () => {
  it.each(['http://127.0.0.1:1234/v1', 'http://localhost:1234/v1', 'http://[::1]:1234/v1'])(
    'matches a loopback host on the configured port: %s',
    (url) => {
      expect(isLmStudioProvider(url, 1234)).toBe(true);
    }
  );

  it('rejects a remote host on the same port', () => {
    expect(isLmStudioProvider('http://10.0.0.5:1234/v1', 1234)).toBe(false);
  });

  it('rejects loopback on a different port', () => {
    expect(isLmStudioProvider('http://127.0.0.1:11434', 1234)).toBe(false);
  });

  it('rejects an unparseable url', () => {
    expect(isLmStudioProvider('not a url', 1234)).toBe(false);
  });
});

describe('mergeModelIds', () => {
  it('keeps backend models that discovery did not report', () => {
    expect(mergeModelIds(['loaded-only-model'], [entry('a')])).toEqual(['a', 'loaded-only-model']);
  });

  it('deduplicates and sorts stably', () => {
    expect(mergeModelIds(['b', 'a'], [entry('b'), entry('c')])).toEqual(['a', 'b', 'c']);
  });

  it('returns the backend list unchanged when discovery found nothing', () => {
    expect(mergeModelIds(['a'], [])).toEqual(['a']);
  });
});
