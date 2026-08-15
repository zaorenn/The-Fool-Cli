/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { parseBrowserCommand, parseFailed } from '@/common/browser/browserCommands';
import { runAgentPageCommand } from './agentPage';

/**
 * How the browser MCP server reaches the browser.
 *
 * The MCP server is a separate `node` process, spawned by the agent runtime; the
 * page it needs to drive lives in this process. Nothing connects those two, so
 * this opens the smallest thing that can: one loopback endpoint, one command
 * per request.
 *
 * Three deliberate constraints, because this is a hole in the app that runs
 * JavaScript inside pages the user is logged into:
 *
 * - **Loopback only.** Bound to 127.0.0.1, never to an interface another machine
 *   can reach.
 * - **A token per launch.** Generated here, never written into configuration.
 *   The port is ephemeral, so it could not be baked into the MCP server's
 *   environment at registration time anyway — both are published to a file in
 *   the user's own data directory, which the MCP process reads at startup. That
 *   file is the capability; anything that can read it could already read the
 *   user's session.
 * - **Commands, not code.** The body is parsed by the shared contract and
 *   nothing else is accepted, so this endpoint cannot be talked into evaluating
 *   something the command set does not describe.
 */

/**
 * Where the port and token are published for the MCP process to find, or an
 * empty string when that cannot be worked out.
 *
 * Guarded rather than assumed: this is called from the migration that registers
 * built-in MCP servers, and `app` is not always there to ask — it is undefined
 * outside a running Electron main process, and an unguarded `app.getPath` threw
 * a TypeError that failed the whole `ensureBootstrapMcpServersInDb` step, taking
 * the image-generation server's registration down with it. A browser tool that
 * cannot be offered is a small loss; a migration that dies is not.
 */
export const browserControlHandshakePath = (): string => {
  try {
    return path.join(app.getPath('userData'), 'fool', 'browser-control.json');
  } catch {
    return '';
  }
};

let server: Server | null = null;
let token: string | null = null;

const unauthorized = (): { status: number; body: unknown } => ({
  status: 401,
  body: { ok: false, error: 'bad token' },
});

const readBody = (request: import('node:http').IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // A command is a few hundred bytes. Anything approaching a megabyte is
      // not one, and reading it would only give a caller a way to spend memory.
      if (size > 1_000_000) {
        request.destroy();
        reject(new Error('command too large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });

/**
 * Starts the endpoint and publishes how to reach it.
 *
 * Safe to call more than once; the second call is a no-op. Never throws — the
 * browser tools becoming unavailable must not stop the app from starting.
 */
export async function startBrowserControlServer(): Promise<void> {
  if (server) return;

  token = randomBytes(32).toString('hex');
  const instance = createServer((request, response) => {
    void (async () => {
      const reply = (status: number, body: unknown): void => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      };

      try {
        if (request.method !== 'POST') return reply(405, { ok: false, error: 'POST only' });
        if (request.headers.authorization !== `Bearer ${token}`) {
          const { status, body } = unauthorized();
          return reply(status, body);
        }

        const raw = await readBody(request);
        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          return reply(400, { ok: false, error: 'body is not JSON' });
        }

        const parsed = parseBrowserCommand((payload as { command?: unknown })?.command);
        if (parseFailed(parsed)) return reply(400, { ok: false, error: parsed.error });

        // Onto the agent's own offscreen page, made on first use and never
        // shown. This used to hop across to the renderer and run against the
        // webview inside the browser panel, which meant every command sent
        // while that panel was closed came back as "the in-app browser is not
        // open, ask the user to open it" — so an agent could not look anything
        // up unless a window was opened in front of somebody first.
        const result = await runAgentPageCommand(parsed.command);
        return reply(200, result);
      } catch (error) {
        return reply(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  await new Promise<void>((resolve) => {
    instance.on('error', (error) => {
      console.warn('[BrowserControl] the endpoint could not start:', error.message);
      resolve();
    });
    instance.listen(0, '127.0.0.1', () => {
      const address = instance.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      try {
        const file = browserControlHandshakePath();
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({ port, token }), { encoding: 'utf8', mode: 0o600 });
        server = instance;
        console.info('[BrowserControl] listening on 127.0.0.1:%d', port);
      } catch (error) {
        console.warn('[BrowserControl] could not publish the handshake file:', error);
      }
      resolve();
    });
  });
}

/** Stops the endpoint and removes the handshake, so a stale token cannot be reused. */
export function stopBrowserControlServer(): void {
  const instance = server;
  server = null;
  token = null;
  try {
    rmSync(browserControlHandshakePath(), { force: true });
  } catch {
    // Nothing to do about it, and the token is dead either way.
  }
  if (!instance) return;
  instance.closeAllConnections?.();
  instance.close();
}
