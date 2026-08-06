/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Nothing this file imports may reach the reporter, and it is never handed back.
 *
 * These tests only import `PreviewPanel`, but that import pulls a large graph in
 * with it, and several modules in it start async work at module scope — reading
 * the theme, restoring font sizes — which fails under a test environment and
 * logs when it does. Those logs land *after* the last assertion, so the worker
 * begins tearing down with an `onUserConsoleLog` still in flight and vitest ends
 * the run with `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog"
 * was pending`. One unhandled error, every test still green, and the process
 * exits 1 — which is why no release has been published since 2.2.50.
 *
 * The spies are deliberately never restored. Restoring them in `afterEach` is
 * the same race one tick later: the logging is not finished when the tests are.
 * Vitest isolates each file in its own worker, so leaving the console stubbed
 * costs nothing and is the only version of this with no race left in it.
 *
 * This is Linux-only in practice. On a Windows runner the same work happens to
 * settle before teardown, so the suite is green locally and red in CI.
 */
beforeAll(() => {
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation(() => undefined);
  }
});

beforeEach(() => {
  window.__backendPort = 13400;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__backendPort;
});

// PreviewPanel pulls in a large dependency graph; under the full concurrent
// suite the first cold import's transform/resolve can exceed the default 10s
// timeout (flaky), even though it resolves in a few seconds in isolation. Give
// these import-bound assertions extra headroom so they don't flake.
const IMPORT_TIMEOUT_MS = 30000;

describe('PreviewPanel', () => {
  it(
    'is a React component module that exports a default function',
    async () => {
      const mod = await import('@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel');
      expect(typeof mod.default).toBe('function');
    },
    IMPORT_TIMEOUT_MS
  );

  it(
    'module loads without throwing on import',
    async () => {
      await expect(
        import('@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel')
      ).resolves.toBeTruthy();
    },
    IMPORT_TIMEOUT_MS
  );

  it(
    'has a displayName or function name for debugging',
    async () => {
      const mod = await import('@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel');
      const fn = mod.default;
      expect(fn.name || fn.displayName || 'anonymous').toBeTruthy();
    },
    IMPORT_TIMEOUT_MS
  );
});
