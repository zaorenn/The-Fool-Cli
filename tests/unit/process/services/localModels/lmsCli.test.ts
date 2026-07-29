/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { readLmsCliModels } from '@process/services/local-models/lmsCli';

const ok = (stdout: string) => vi.fn().mockResolvedValue({ stdout });

describe('readLmsCliModels', () => {
  it('returns every llm and vlm entry', async () => {
    const execFile = ok(
      JSON.stringify([
        {
          type: 'llm',
          modelKey: 'qwen/qwen3-14b',
          displayName: 'Qwen3 14B',
          maxContextLength: 40960,
          trainedForToolUse: true,
        },
        {
          type: 'vlm',
          modelKey: 'google/gemma-4-e4b',
          displayName: 'Gemma 4',
          maxContextLength: 8192,
          trainedForToolUse: false,
        },
      ])
    );

    const models = await readLmsCliModels({ execFile, homeDir: 'C:/Users/x' });

    expect(models).toEqual([
      { id: 'qwen/qwen3-14b', displayName: 'Qwen3 14B', contextLength: 40960, toolUse: true },
      { id: 'google/gemma-4-e4b', displayName: 'Gemma 4', contextLength: 8192, toolUse: false },
    ]);
  });

  it('excludes embedding models', async () => {
    const execFile = ok(
      JSON.stringify([
        { type: 'embedding', modelKey: 'nomic-embed-text' },
        { type: 'llm', modelKey: 'qwen/qwen3-14b' },
      ])
    );

    const models = await readLmsCliModels({ execFile, homeDir: 'C:/Users/x' });

    expect(models?.map((model) => model.id)).toEqual(['qwen/qwen3-14b']);
  });

  it('skips entries with no usable modelKey instead of failing the whole read', async () => {
    const execFile = ok(
      JSON.stringify([{ type: 'llm' }, { type: 'llm', modelKey: '' }, { type: 'llm', modelKey: 'a' }])
    );

    const models = await readLmsCliModels({ execFile, homeDir: 'C:/Users/x' });

    expect(models?.map((model) => model.id)).toEqual(['a']);
  });

  it('falls back to the model key when no display name is present', async () => {
    const execFile = ok(JSON.stringify([{ type: 'llm', modelKey: 'bonsai-27b@bf16' }]));

    const models = await readLmsCliModels({ execFile, homeDir: 'C:/Users/x' });

    expect(models).toEqual([
      { id: 'bonsai-27b@bf16', displayName: 'bonsai-27b@bf16', contextLength: null, toolUse: false },
    ]);
  });

  it('returns null when the output is not JSON', async () => {
    expect(await readLmsCliModels({ execFile: ok('not json'), homeDir: 'C:/Users/x' })).toBeNull();
  });

  it('returns null when the parsed output is not an array', async () => {
    expect(await readLmsCliModels({ execFile: ok('{"models":[]}'), homeDir: 'C:/Users/x' })).toBeNull();
  });

  it('returns null when the executable is missing', async () => {
    const execFile = vi.fn().mockRejectedValue(new Error('ENOENT'));

    expect(await readLmsCliModels({ execFile, homeDir: 'C:/Users/x' })).toBeNull();
  });

  it('tries the bare command after the home directory candidates fail', async () => {
    const execFile = vi
      .fn()
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ type: 'llm', modelKey: 'a' }]) });

    const models = await readLmsCliModels({ execFile, homeDir: 'C:/Users/x' });

    expect(models?.map((model) => model.id)).toEqual(['a']);
    expect(execFile).toHaveBeenCalledTimes(3);
    expect(execFile).toHaveBeenLastCalledWith('lms', ['ls', '--json'], { timeout: 5000 });
  });
});
