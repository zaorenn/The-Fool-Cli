/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ checkToolInstalled: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: { shell: { checkToolInstalled: { invoke: mocks.checkToolInstalled } } },
}));

import { detectAgents, detectGateways } from '@renderer/services/setup/detectSetup';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const answering = (byUrl: Record<string, { ok: boolean; models?: number }>) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const entry = byUrl[String(url)];
      if (!entry) throw new Error('connection refused');
      return {
        ok: entry.ok,
        json: async () => ({ data: Array.from({ length: entry.models ?? 0 }, (_, i) => ({ id: `m${i}` })) }),
      } as unknown as Response;
    })
  );

describe('detectGateways', () => {
  it('finds a running gateway and counts what it has loaded', async () => {
    answering({ 'http://127.0.0.1:20128/v1/models': { ok: true, models: 4 } });

    const found = await detectGateways();

    expect(found.get('omniroute')).toBe('ready');
  });

  it('separates a gateway that is up with nothing loaded', async () => {
    // Telling somebody to install what is already there is the worse mistake.
    answering({ 'http://127.0.0.1:1234/v1/models': { ok: true, models: 0 } });

    expect((await detectGateways()).get('lm-studio')).toBe('running-empty');
  });

  it('treats a refused connection as absent rather than throwing', async () => {
    // One dead port must not take the whole list with it.
    answering({});

    const found = await detectGateways();

    expect(found.get('omniroute')).toBe('absent');
    expect(found.get('ollama')).toBe('absent');
  });
});

describe('detectAgents', () => {
  it('reports what is on PATH', async () => {
    mocks.checkToolInstalled.mockImplementation(async ({ tool }: { tool: string }) => tool === 'claude');

    const found = await detectAgents();

    expect(found.get('claude-code')).toEqual({ installed: true });
    expect(found.get('codex')).toEqual({ installed: false });
  });

  it('leaves sign-in unknown rather than guessing at it', async () => {
    // Asking a CLI whether it holds a credential means running it, which is
    // slow and rude. The panel offers "use this" and a failure that says why.
    mocks.checkToolInstalled.mockResolvedValue(true);

    expect((await detectAgents()).get('claude-code')?.signedIn).toBeUndefined();
  });

  it('survives a backend that is not answering', async () => {
    mocks.checkToolInstalled.mockRejectedValue(new Error('backend is down'));

    const found = await detectAgents();

    expect(found.get('codex')).toEqual({ installed: false });
  });
});
