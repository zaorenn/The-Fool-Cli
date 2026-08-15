/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reading the window instead of guessing it.
 *
 * The payloads below are what the server on this machine actually returned,
 * trimmed to the fields that are read. `/v1/models` is included precisely
 * because it carries nothing useful: that is why the second endpoint exists.
 */

import { describe, expect, it } from 'vitest';
import { USABLE_CONTEXT_CAP_TOKENS, lmStudioModelsUrl, pickLoadedContext } from '@/common/voice/contextWindow';
import { historyBudgetTokens } from '@/common/voice/contextBudget';

/** `GET /api/v0/models`, as recorded. */
const LM_STUDIO = {
  data: [
    { id: 'qwen/qwen3.5-9b', state: 'loaded', max_context_length: 262144, loaded_context_length: 64256 },
    { id: 'voxtral-realtime-et', state: 'loaded', max_context_length: null, loaded_context_length: 2048 },
    { id: 'hermes-3-llama-3.1-8b', state: 'not-loaded', max_context_length: 131072, loaded_context_length: null },
  ],
};

/** `GET /v1/models`, as recorded. Nothing here says how much anything can read. */
const OPENAI_SHAPE = {
  data: [{ id: 'qwen/qwen3.5-9b', object: 'model', owned_by: 'organization_owner' }],
};

describe('where to ask', () => {
  it('swaps the OpenAI prefix for LM Studio’s own, on the same server', () => {
    expect(lmStudioModelsUrl('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/api/v0/models');
    expect(lmStudioModelsUrl('http://127.0.0.1:1234/v1/')).toBe('http://127.0.0.1:1234/api/v0/models');
  });

  it('leaves an address that is not that shape alone', () => {
    expect(lmStudioModelsUrl('http://localhost:8080')).toBe('http://localhost:8080/api/v0/models');
  });
});

describe('what the answer means', () => {
  it('reads the window the model was loaded with', () => {
    expect(pickLoadedContext(LM_STUDIO, 'qwen/qwen3.5-9b')).toBe(64256);
  });

  it('never reports what the weights allow instead', () => {
    // 262144 is in the same record and is the wrong number: it promises room
    // the server has not allocated.
    expect(pickLoadedContext(LM_STUDIO, 'qwen/qwen3.5-9b')).not.toBe(262144);
  });

  it('answers null for a model nobody has loaded', () => {
    expect(pickLoadedContext(LM_STUDIO, 'hermes-3-llama-3.1-8b')).toBeNull();
  });

  it('answers null for the OpenAI-shaped list, which carries no window at all', () => {
    expect(pickLoadedContext(OPENAI_SHAPE, 'qwen/qwen3.5-9b')).toBeNull();
  });

  it('answers null rather than throwing on anything unexpected', () => {
    expect(pickLoadedContext(null, 'x')).toBeNull();
    expect(pickLoadedContext({}, 'x')).toBeNull();
    expect(pickLoadedContext({ data: 'nonsense' }, 'x')).toBeNull();
    expect(pickLoadedContext({ data: [{ id: 'x', state: 'loaded', loaded_context_length: -5 }] }, 'x')).toBeNull();
  });
});

describe('what reading it buys', () => {
  it('turns a budget of nothing into room for a long conversation', () => {
    // The two numbers that matter, side by side. Assumed, the fixed cost of the
    // spoken turn leaves nothing for the conversation; measured, it leaves tens
    // of thousands of tokens. This is the whole reason for asking.
    const assumed = historyBudgetTokens(undefined);
    const measured = historyBudgetTokens(64256);

    expect(assumed).toBe(0);
    expect(measured).toBeGreaterThan(30_000);
  });
});

/**
 * Read from the running server: the 8B is loaded at 131,072 tokens and the 14B
 * supports 32,768, which is why the larger model is the faster one. Planning a
 * prompt around the larger window pays prefill per token for history nobody
 * asked to keep.
 */
describe('the cap on what is planned for', () => {
  const listed = (id: string, loaded: number) => ({
    data: [{ id, state: 'loaded', loaded_context_length: loaded }],
  });

  it('cuts a window nobody would have chosen down to the cap', () => {
    expect(
      pickLoadedContext(listed('deepseek/deepseek-r1-0528-qwen3-8b', 131_072), 'deepseek/deepseek-r1-0528-qwen3-8b')
    ).toBe(USABLE_CONTEXT_CAP_TOKENS);
  });

  it('leaves a window already under the cap alone', () => {
    expect(pickLoadedContext(listed('qwen/qwen3-14b', 8_192), 'qwen/qwen3-14b')).toBe(8_192);
  });

  /// Not tighter: the budget arithmetic was calibrated against the 64,256 this
  /// machine reports, and 32,768 would leave about 12,000 tokens for the
  /// conversation where 65,536 leaves about 37,000.
  it('leaves the measured window of this machine untouched', () => {
    expect(pickLoadedContext(listed('qwen/qwen3.5-9b', 64_256), 'qwen/qwen3.5-9b')).toBe(64_256);
  });
});
