/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { scanModelDirectory } from '@process/services/local-models/modelDirScan';

const tree: Record<string, { name: string; isDirectory: boolean }[]> = {
  '/models': [{ name: 'qwen', isDirectory: true }],
  '/models/qwen': [{ name: 'Qwen3-14B-GGUF', isDirectory: true }],
  '/models/qwen/Qwen3-14B-GGUF': [
    { name: 'Qwen3-14B-Q4_K_M.gguf', isDirectory: false },
    { name: 'mmproj-Qwen3-14B-BF16.gguf', isDirectory: false },
    { name: 'README.md', isDirectory: false },
  ],
};

const fs = { readdir: vi.fn(async (path: string) => tree[path] ?? []) };

describe('scanModelDirectory', () => {
  it('finds nested gguf models and excludes mmproj projectors and non-gguf files', async () => {
    const models = await scanModelDirectory({ fs, root: '/models' });

    expect(models).toEqual([
      {
        id: 'qwen/Qwen3-14B-GGUF/Qwen3-14B-Q4_K_M.gguf',
        displayName: 'Qwen3-14B-Q4_K_M',
        contextLength: null,
        toolUse: false,
      },
    ]);
  });

  it('returns an empty list rather than null when the tree holds no models', async () => {
    const emptyFs = { readdir: vi.fn(async () => []) };

    expect(await scanModelDirectory({ fs: emptyFs, root: '/models' })).toEqual([]);
  });

  it('returns null when the root cannot be read', async () => {
    const failing = { readdir: vi.fn().mockRejectedValue(new Error('EACCES')) };

    expect(await scanModelDirectory({ fs: failing, root: '/models' })).toBeNull();
  });

  it('does not descend past the depth limit', async () => {
    const deep: Record<string, { name: string; isDirectory: boolean }[]> = {
      '/models': [{ name: 'a', isDirectory: true }],
      '/models/a': [{ name: 'b', isDirectory: true }],
      '/models/a/b': [{ name: 'c', isDirectory: true }],
      '/models/a/b/c': [{ name: 'buried.gguf', isDirectory: false }],
    };
    const deepFs = { readdir: vi.fn(async (path: string) => deep[path] ?? []) };

    expect(await scanModelDirectory({ fs: deepFs, root: '/models' })).toEqual([]);
  });

  it('stops at the file cap instead of walking an unbounded tree', async () => {
    const many = Array.from({ length: 3000 }, (_, index) => ({ name: `m${index}.gguf`, isDirectory: false }));
    const bigFs = { readdir: vi.fn(async () => many) };

    const models = await scanModelDirectory({ fs: bigFs, root: '/models' });

    expect(models?.length).toBe(2000);
  });
});
