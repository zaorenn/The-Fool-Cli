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
 * The page being driven is the agent's own, rendered offscreen, and the user
 * never sees it appear. It shares the `persist:fool-browser` partition with the
 * browser panel, so it carries the user's logins without carrying their window
 * — which is the distinction these descriptions have to keep making. The model
 * is acting as the user on sites they are signed into, and it is doing so in
 * the background, where nothing it tries lands in front of them.
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
    'Where the agent browser currently is: the page URL and title. It starts blank, so an empty URL means nothing has been opened yet rather than that something failed.',
    {},
    async () => ({ content: [{ type: 'text' as const, text: await run({ name: 'state' }) }] })
  );

  server.tool(
    'browser_read',
    'Read the text of the page the agent browser is on. Prefer this over a screenshot when you want the words rather than the layout — it is far cheaper and it can be searched. Optionally pass a CSS selector to read one part of the page. Long pages load as you scroll, so use browser_scroll and read again rather than reporting the first screen as the whole article.',
    { selector: z.string().optional(), maxChars: z.number().optional() },
    async ({ selector, maxChars }) => ({
      content: [{ type: 'text' as const, text: await run({ name: 'read', selector, maxChars }) }],
    })
  );

  server.tool(
    'browser_navigate',
    "Open a page in the agent's own browser, in the background. Accepts a URL, a bare hostname, or a search phrase — anything that is not a web address becomes a search. Local files cannot be opened. Nothing appears on the user's screen: this is for looking things up yourself, and if they should see the page, say what you found and offer to open it.",
    { url: z.string() },
    async ({ url }) => ({ content: [{ type: 'text' as const, text: await run({ name: 'navigate', url }) }] })
  );

  server.tool(
    'browser_click',
    "Click an element in the agent browser, chosen by CSS selector. This browser shares the user's logins, so a click here acts as them on any site they are signed into — and they cannot see it happening. Read the page first, and for anything consequential (sending, buying, posting, deleting) ask them before you press it rather than after.",
    { selector: z.string() },
    async ({ selector }) => ({ content: [{ type: 'text' as const, text: await run({ name: 'click', selector }) }] })
  );

  server.tool(
    'browser_type',
    "Type into a field in the agent browser, chosen by CSS selector. Set submit to true to submit the field's form afterwards. Never type credentials, card numbers or other secrets — ask the user to enter those themselves.",
    { selector: z.string(), text: z.string(), submit: z.boolean().optional() },
    async ({ selector, text, submit }) => ({
      content: [{ type: 'text' as const, text: await run({ name: 'type', selector, text, submit }) }],
    })
  );

  server.tool('browser_back', 'Go back one page in the agent browser.', {}, async () => ({
    content: [{ type: 'text' as const, text: await run({ name: 'back' }) }],
  }));

  server.tool('browser_forward', 'Go forward one page in the agent browser.', {}, async () => ({
    content: [{ type: 'text' as const, text: await run({ name: 'forward' }) }],
  }));

  // `screenshot` was implemented in the command contract long before any tool
  // advertised it, so the one capability that lets an agent check its own work
  // was unreachable. The picture is of the agent's own page — nothing here can
  // see the user's desktop, or any window belonging to them.
  server.tool(
    'browser_screenshot',
    "A picture of the page the agent browser is on — the page under test, never the user's desktop or any window of theirs. Use it to check that something you built or changed actually looks right. Prefer browser_read when you want the words: a picture costs far more to look at and cannot be searched.",
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
    'What the page has logged, including its errors. The other half of checking that something works: a screenshot of a broken page looks like a screenshot of a working one, and the difference is usually sitting here. Pass onlyErrors to skip the noise.',
    { onlyErrors: z.boolean().optional(), limit: z.number().optional() },
    async ({ onlyErrors, limit }) => ({
      content: [{ type: 'text' as const, text: await run({ name: 'console', onlyErrors, limit }) }],
    })
  );

  server.tool(
    'browser_network',
    'What the page asked the network for and what came back, including requests that failed. Use it when a page renders empty or a feature does nothing: an empty page and a page whose data request returned 500 look identical from the outside, and this is where they differ. Pass urlPattern to narrow to one endpoint.',
    { urlPattern: z.string().optional(), limit: z.number().optional() },
    async ({ urlPattern, limit }) => ({
      content: [{ type: 'text' as const, text: await run({ name: 'network', urlPattern, limit }) }],
    })
  );

  server.tool(
    'browser_scroll',
    'Move the page, either to an element or by about a screenful. Half the web loads as you scroll, so reading a long page without this gives you the first screen and nothing else — and a summary written from it will confidently describe an article whose body never rendered. Reports how far down the page you now are.',
    {
      selector: z.string().optional(),
      direction: z.enum(['up', 'down']).optional(),
      amount: z.number().optional(),
    },
    async ({ selector, direction, amount }) => ({
      content: [{ type: 'text' as const, text: await run({ name: 'scroll', selector, direction, amount }) }],
    })
  );

  server.tool(
    'browser_select',
    'Choose an option in a dropdown, by its value or by the text the user would see. Matching on the visible label is usually what you want: the value attribute is often a code nobody wrote down.',
    { selector: z.string(), value: z.string() },
    async ({ selector, value }) => ({
      content: [{ type: 'text' as const, text: await run({ name: 'select', selector, value }) }],
    })
  );

  server.tool(
    'browser_press',
    'Press a key, at an element or wherever the focus already is. Enter, Escape, Tab and the arrows are how a real form is finished — plenty of pages have no submit button to click at all. Never type or press through a credential prompt: ask the user to sign in themselves.',
    { key: z.string(), selector: z.string().optional() },
    async ({ key, selector }) => ({
      content: [{ type: 'text' as const, text: await run({ name: 'press', key, selector }) }],
    })
  );

  server.tool(
    'browser_hover',
    'Hover over an element, for the menus and tooltips that exist only while a pointer is on them. A dropdown you cannot find in the markup is usually one that has not been built yet because nothing has hovered.',
    { selector: z.string() },
    async ({ selector }) => ({ content: [{ type: 'text' as const, text: await run({ name: 'hover', selector }) }] })
  );

  server.tool(
    'browser_resize',
    'Set the viewport size, which is how a layout is checked at another width. 375x812 is a phone, 768x1024 a tablet, 1280x800 a desktop. The page re-runs its media queries, so read or screenshot again afterwards rather than describing what you saw before.',
    { width: z.number(), height: z.number() },
    async ({ width, height }) => ({
      content: [{ type: 'text' as const, text: await run({ name: 'resize', width, height }) }],
    })
  );

  server.tool(
    'browser_evaluate',
    "Evaluate a JavaScript expression in the page and get its value back. This is for reading something the other tools cannot reach — a computed style, a value held in a variable, the length of a list. Do not use it to change how the page looks or behaves: a change made here disappears on the next reload, so the fix belongs in the source. The expression runs with the page's own authority on a site the user is signed into.",
    { expression: z.string() },
    async ({ expression }) => ({
      content: [{ type: 'text' as const, text: await run({ name: 'evaluate', expression }) }],
    })
  );

  await server.connect(new StdioServerTransport());
}

void main().catch((error: unknown) => {
  console.error('[builtin-mcp-browser] failed to start:', error);
  process.exit(1);
});
