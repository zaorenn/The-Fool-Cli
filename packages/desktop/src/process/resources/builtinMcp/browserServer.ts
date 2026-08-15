/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in MCP server for the in-app browser.
 *
 * Runs as a standalone stdio process, like the image-generation server beside
 * it, and talks to the app over the loopback endpoint the main process opens.
 * The port and token are read from the handshake file rather than the
 * environment: the port is ephemeral, so anything baked into this server's
 * configuration at registration time would be stale by the next launch.
 *
 * The browser being driven is the one the user can see, with their sessions in
 * it. Tool descriptions say so plainly — the model should know it is acting as
 * the user on sites they are signed into, not browsing anonymously.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { BUILTIN_BROWSER_NAME } from './constants';

type Handshake = { port: number; token: string };

/**
 * Read afresh for every call rather than cached.
 *
 * The app may have restarted since this process started, and a restart means a
 * new port and a new token. Re-reading costs nothing next to a page load and
 * removes a whole class of "worked until you restarted the app".
 */
function readHandshake(): Handshake | null {
  const file = process.env.FOOL_BROWSER_HANDSHAKE;
  if (!file) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Handshake>;
    if (typeof parsed.port !== 'number' || typeof parsed.token !== 'string') return null;
    return { port: parsed.port, token: parsed.token };
  } catch {
    return null;
  }
}

const UNAVAILABLE =
  'The Fool is not reachable, so the in-app browser cannot be driven. The app may be closed or still starting.';

async function run(command: Record<string, unknown>): Promise<string> {
  const handshake = readHandshake();
  if (!handshake) return UNAVAILABLE;

  try {
    const response = await fetch(`http://127.0.0.1:${handshake.port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${handshake.token}` },
      body: JSON.stringify({ command }),
    });
    const result = (await response.json()) as { ok?: boolean; data?: unknown; error?: string };
    if (result.ok) return JSON.stringify(result.data ?? {}, null, 2);
    return `Browser command failed: ${result.error ?? 'unknown error'}`;
  } catch (error) {
    return `${UNAVAILABLE} (${error instanceof Error ? error.message : String(error)})`;
  }
}

async function main(): Promise<void> {
  const server = new McpServer({ name: BUILTIN_BROWSER_NAME, version: '1.0.0' });

  server.tool(
    'browser_state',
    "Where The Fool's built-in browser currently is: the page URL and title. Use this first to find out whether the browser is open and what it is showing.",
    {},
    async () => ({ content: [{ type: 'text' as const, text: await run({ name: 'state' }) }] })
  );

  server.tool(
    'browser_read',
    'Read the visible text of the page open in the built-in browser. Prefer this over a screenshot when you want the words rather than the layout. Optionally pass a CSS selector to read one part of the page.',
    { selector: z.string().optional(), maxChars: z.number().optional() },
    async ({ selector, maxChars }) => ({
      content: [{ type: 'text' as const, text: await run({ name: 'read', selector, maxChars }) }],
    })
  );

  server.tool(
    'browser_navigate',
    "Open a page in The Fool's built-in browser. Accepts a URL, a bare hostname, or a search phrase — anything that is not a web address becomes a search. Local files cannot be opened.",
    { url: z.string() },
    async ({ url }) => ({ content: [{ type: 'text' as const, text: await run({ name: 'navigate', url }) }] })
  );

  server.tool(
    'browser_click',
    "Click an element in the built-in browser, chosen by CSS selector. This browser keeps the user's logins, so a click here acts as them on any site they are signed into. Read the page first and tell the user what you are about to press if it does anything consequential.",
    { selector: z.string() },
    async ({ selector }) => ({ content: [{ type: 'text' as const, text: await run({ name: 'click', selector }) }] })
  );

  server.tool(
    'browser_type',
    "Type into a field in the built-in browser, chosen by CSS selector. Set submit to true to submit the field's form afterwards. Never type credentials, card numbers or other secrets — ask the user to enter those themselves.",
    { selector: z.string(), text: z.string(), submit: z.boolean().optional() },
    async ({ selector, text, submit }) => ({
      content: [{ type: 'text' as const, text: await run({ name: 'type', selector, text, submit }) }],
    })
  );

  server.tool('browser_back', 'Go back one page in the built-in browser.', {}, async () => ({
    content: [{ type: 'text' as const, text: await run({ name: 'back' }) }],
  }));

  server.tool('browser_forward', 'Go forward one page in the built-in browser.', {}, async () => ({
    content: [{ type: 'text' as const, text: await run({ name: 'forward' }) }],
  }));

  // `screenshot` has been implemented in the command contract and in the
  // renderer's controller since this server was written, and no tool ever
  // advertised it — so the one capability that lets an agent check its own work
  // was unreachable. The picture is of the page under test, not of the user's
  // desktop; nothing here can see outside the panel.
  server.tool(
    'browser_screenshot',
    "A picture of the page open in The Fool's built-in browser — the page under test, not the user's desktop. Use it to check that something you built or changed actually looks right, and to show the user what you saw. Prefer browser_read when you want the words: a picture costs far more to look at and cannot be searched.",
    {},
    async () => ({ content: [{ type: 'text' as const, text: await run({ name: 'screenshot' }) }] })
  );

  server.tool(
    'browser_wait_for',
    'Waits until something appears on the page before you carry on. Use it after every navigation and every click that loads something: without it you are guessing at timing, and you will read the page as it was a moment before it finished. If the thing never appears this says so — that is a fact about the page, so report it rather than describing what you expected to be there.',
    { selector: z.string(), timeoutMs: z.number().optional() },
    async ({ selector, timeoutMs }) => ({
      content: [{ type: 'text' as const, text: await run({ name: 'waitFor', selector, timeoutMs }) }],
    })
  );

  server.tool(
    'browser_console',
    'What the page has logged, including its errors, since the browser panel opened. The other half of checking that something works: a screenshot of a broken page looks like a screenshot of a working one, and the difference is usually sitting here. Pass onlyErrors to skip the noise.',
    { onlyErrors: z.boolean().optional(), limit: z.number().optional() },
    async ({ onlyErrors, limit }) => ({
      content: [{ type: 'text' as const, text: await run({ name: 'console', onlyErrors, limit }) }],
    })
  );

  await server.connect(new StdioServerTransport());
}

void main().catch((error: unknown) => {
  console.error('[builtin-mcp-browser] failed to start:', error);
  process.exit(1);
});
