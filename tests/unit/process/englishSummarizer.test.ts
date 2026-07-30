/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  cleanSummaryOutput,
  looksEnglish,
  summarizeToEnglish,
} from '@process/services/voice-summary/EnglishSummarizer';
import type { SummaryEndpoint } from '@process/services/voice-summary/summaryModelResolver';

const localEndpoint: SummaryEndpoint = {
  modelId: 'qwen3-4b',
  displayName: 'qwen3-4b',
  baseUrl: 'http://127.0.0.1:1234/v1',
  apiKey: '',
  local: true,
};

const remoteEndpoint: SummaryEndpoint = {
  ...localEndpoint,
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-remote',
  local: false,
};

const reply = (content: string, finishReason = 'stop') =>
  ({
    ok: true,
    json: () => Promise.resolve({ choices: [{ message: { content }, finish_reason: finishReason }] }),
  }) as unknown as Response;

/** A reasoning model that spent its whole budget thinking and said nothing. */
const truncated = () => reply('', 'length');

const run = (fetchImpl: typeof fetch, endpoint: SummaryEndpoint = localEndpoint) =>
  summarizeToEnglish({
    endpoint,
    text: 'Testler geçti ve iki dosya değişti.',
    maxCharacters: 400,
    timeoutMs: 5000,
    fetchImpl,
  });

describe('summarizeToEnglish', () => {
  it('returns the briefing the model produced', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply('The tests passed and two files changed.'));

    const outcome = await run(fetchImpl as unknown as typeof fetch);

    expect(outcome).toEqual({ ok: true, text: 'The tests passed and two files changed.', translated: true });
  });

  it('asks the chosen model over OpenAI chat completions', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply('Fine.'));

    await run(fetchImpl as unknown as typeof fetch);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:1234/v1/chat/completions');
    const body = JSON.parse(String(init.body)) as {
      model: string;
      stream: boolean;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe('qwen3-4b');
    expect(body.stream).toBe(false);
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toContain('Testler geçti ve iki dosya değişti.');
    // The character budget has to reach the model, or it writes an essay.
    expect(body.messages[0].content).toContain('400 characters');
    expect(body.messages[0].content).toContain('English words only');
  });

  it('asks again, and says it plainly, when the model answered in the wrong language', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(reply('Testler geçti ve iki dosya değişti.'))
      .mockResolvedValueOnce(reply('The tests passed and two files changed.'));

    const outcome = await run(fetchImpl as unknown as typeof fetch);

    expect(outcome).toEqual({ ok: true, text: 'The tests passed and two files changed.', translated: true });
    const [, second] = fetchImpl.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(second.body)) as { messages: { content: string }[] };
    expect(body.messages[1].content).toContain('Answer in English.');
  });

  it('speaks a shortened reply that stayed in its language rather than nothing', async () => {
    // Worse than an English briefing, better than reading the whole reply.
    const fetchImpl = vi.fn().mockResolvedValue(reply('Testler geçti ve iki dosya değişti.'));

    const outcome = await run(fetchImpl as unknown as typeof fetch);

    expect(outcome).toEqual({ ok: true, text: 'Testler geçti ve iki dosya değişti.', translated: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps the first answer when the insistent retry comes back empty', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply('Testler geçti.')).mockResolvedValueOnce(truncated());

    expect(await run(fetchImpl as unknown as typeof fetch)).toEqual({
      ok: true,
      text: 'Testler geçti.',
      translated: false,
    });
  });

  it('asks a local host not to think, which is the difference between half a second and seven', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply('Fine.'));

    await run(fetchImpl as unknown as typeof fetch);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.reasoning_effort).toBe('none');
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('sends no reasoning hints to a remote API that may reject them', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply('Fine.'));

    await run(fetchImpl as unknown as typeof fetch, remoteEndpoint);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body).not.toHaveProperty('chat_template_kwargs');
  });

  it('asks again with room to think when the model said nothing and ran out of tokens', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(truncated()).mockResolvedValueOnce(reply('The tests passed.'));

    const outcome = await run(fetchImpl as unknown as typeof fetch);

    expect(outcome).toEqual({ ok: true, text: 'The tests passed.', translated: true });
    const [, second] = fetchImpl.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(second.body)) as { max_tokens: number };
    const [, first] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const firstBody = JSON.parse(String(first.body)) as { max_tokens: number };
    expect(body.max_tokens).toBeGreaterThan(firstBody.max_tokens);
  });

  it('gives up after the second attempt rather than asking forever', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(truncated());

    expect(await run(fetchImpl as unknown as typeof fetch)).toEqual({ ok: false, failure: 'empty-output' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry an answer that was complete but unusable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply('   '));

    expect(await run(fetchImpl as unknown as typeof fetch)).toEqual({ ok: false, failure: 'empty-output' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends no Authorization header to a host that wants no key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply('Fine.'));

    await run(fetchImpl as unknown as typeof fetch);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('sends the provider key when there is one', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply('Fine.'));

    await run(fetchImpl as unknown as typeof fetch, remoteEndpoint);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-remote' });
  });

  it('reports an unreachable host rather than throwing at the caller', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    expect(await run(fetchImpl as unknown as typeof fetch)).toEqual({ ok: false, failure: 'unreachable' });
  });

  it('treats a rejected request as unreachable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 } as unknown as Response);

    expect(await run(fetchImpl as unknown as typeof fetch)).toEqual({ ok: false, failure: 'unreachable' });
  });

  it('distinguishes a model that answered too late', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const fetchImpl = vi.fn().mockRejectedValue(abort);

    expect(await run(fetchImpl as unknown as typeof fetch)).toEqual({ ok: false, failure: 'timeout' });
  });

  it('rejects an answer with nothing speakable left in it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply('<think>hmm, what did they mean</think>'));

    expect(await run(fetchImpl as unknown as typeof fetch)).toEqual({ ok: false, failure: 'empty-output' });
  });

  it('rejects an answer that is not text at all', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: {}, finish_reason: 'stop' }] }),
    } as unknown as Response);

    expect(await run(fetchImpl as unknown as typeof fetch)).toEqual({ ok: false, failure: 'empty-output' });
  });

  it('aborts the request once the timeout passes', async () => {
    vi.useFakeTimers();
    try {
      let seen: AbortSignal | undefined;
      const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
        seen = init.signal ?? undefined;
        return new Promise<Response>(() => {
          // Never settles: the timeout is the only thing that ends this.
        });
      });

      void summarizeToEnglish({
        endpoint: localEndpoint,
        text: 'Anything.',
        maxCharacters: 400,
        timeoutMs: 3000,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      await Promise.resolve();
      expect(seen?.aborted).toBe(false);
      vi.advanceTimersByTime(3000);
      expect(seen?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('looksEnglish', () => {
  it('accepts an English briefing', () => {
    expect(looksEnglish('The tests passed and two files changed.')).toBe(true);
  });

  it('tolerates a borrowed name', () => {
    expect(looksEnglish('The release is named after Björk and the tests pass.')).toBe(true);
  });

  it('rejects Turkish', () => {
    expect(looksEnglish('Testler geçti ve iki dosya değişti.')).toBe(false);
  });

  it('rejects Russian', () => {
    expect(looksEnglish('Тесты прошли, изменились два файла.')).toBe(false);
  });

  it('rejects Japanese', () => {
    expect(looksEnglish('テストは通り、二つのファイルが変更されました。')).toBe(false);
  });

  it('rejects text with no letters at all', () => {
    expect(looksEnglish('… 123 —')).toBe(false);
  });
});

describe('cleanSummaryOutput', () => {
  it('drops a reasoning model’s thinking block', () => {
    expect(cleanSummaryOutput('<think>let me see</think>The tests pass.')).toBe('The tests pass.');
  });

  it('drops a thinking block the model never closed', () => {
    // Ran out of budget mid-thought: there is no answer after it to keep.
    expect(cleanSummaryOutput('The tests pass. <think>now, should I mention')).toBe('The tests pass.');
  });

  it('unwraps a briefing the model put in quotes', () => {
    expect(cleanSummaryOutput('“The tests pass.”')).toBe('The tests pass.');
  });

  it('collapses the line breaks a synthesiser would read as pauses', () => {
    expect(cleanSummaryOutput('The tests pass.\n\nTwo files changed.')).toBe('The tests pass. Two files changed.');
  });
});
