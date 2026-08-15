/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The page the agent browses, which the user never sees arrive.
 *
 * Every browser command used to be answered by the renderer, against the
 * webview inside the browser panel. That had one consequence nobody wrote down
 * and everybody hit: with the panel closed — which is every session that did
 * not start by opening it — the answer was *"The in-app browser is not open.
 * Ask the user to open it, then try again."* So the agent could not look
 * anything up on its own. It could only ask somebody to open a panel first, and
 * then browse in front of them.
 *
 * That is the wrong shape twice over. Research is background work: asked to
 * find a paper, the useful thing is the paper, not a tour of the search results.
 * And a panel that opens because a tool call needed it is a window appearing
 * over whatever the user was doing, for a reason they never asked about.
 *
 * So the agent gets a page of its own, rendered offscreen, which is never shown
 * and cannot be shown. Two things fall out of that which are worth stating:
 *
 * - **The user's logins still work.** The page runs in `persist:fool-browser`,
 *   the same partition as the visible panel, so a site they are signed into in
 *   the panel is a site this is signed into. Sessions live in the partition,
 *   not in the window. That is also the reason every acting command is still
 *   treated as acting *as them* — see `commandActsOnPage`.
 * - **The user's own page is left alone.** The panel is theirs: if they have it
 *   open on something, an agent looking three things up does not navigate it
 *   out from under them.
 *
 * Offscreen rendering rather than a plain hidden window, because a window that
 * is merely not shown is also not painted, and `capturePage` on one returns an
 * empty image. `offscreen: true` keeps a real compositor running with no
 * surface on any display, which is what makes `screenshot` mean something here.
 */

import { BrowserWindow, type WebContents } from 'electron';
import {
  DEFAULT_WAIT_MS,
  MAX_CONSOLE_LINES,
  MAX_NETWORK_ENTRIES,
  MAX_READ_CHARS,
  type BrowserCommand,
} from '@/common/browser/browserCommands';
import { BROWSER_PARTITION, resolveBrowserInput } from '@/common/browser/browserSession';

export type AgentPageResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

/** The viewport the page starts at, and what `resize` moves it from. */
const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;

/** How long any single command may hold the turn open. */
const COMMAND_TIMEOUT_MS = 45_000;

type ConsoleLine = { level: string; text: string };
type NetworkEntry = { url: string; status: number; type: string; failed?: string };

/**
 * The page, its log, and its traffic.
 *
 * All three are created together and destroyed together: a console line
 * belongs to the page that emitted it, and keeping the log alive across a
 * teardown would report a previous page's errors as this one's.
 */
type Page = {
  window: BrowserWindow;
  console: ConsoleLine[];
  network: NetworkEntry[];
};

let page: Page | null = null;

const LEVELS: Record<number, string> = { 0: 'log', 1: 'info', 2: 'warn', 3: 'error' };

/**
 * Records what the page logs and what it asks the network for.
 *
 * The console is an event stream and nothing else: a message exists when it is
 * emitted and nowhere afterwards, so it is collected from the moment the page
 * exists rather than asked for when somebody wants it.
 *
 * The network is read through this page's own debugger session rather than
 * through `session.webRequest`. The partition is shared with the visible panel,
 * and `webRequest` listeners are per-session and single-slot — registering one
 * here would both capture the user's own browsing and quietly displace anything
 * the panel had registered. A debugger session is scoped to one webContents,
 * which is exactly the scope this needs.
 */
const collect = (contents: WebContents, into: Page): void => {
  contents.on('console-message', (...args: unknown[]) => {
    // Electron changed this signature: older builds emit
    // (event, level, message, line, sourceId) and newer ones emit a single
    // details object. Both are read rather than one being assumed, because
    // guessing wrong makes the log silently empty and an empty log reads as a
    // page that logged nothing.
    const [first, second, third] = args;
    const details = first as { level?: number | string; message?: string } | undefined;
    const level = typeof details?.level === 'string' ? details.level : LEVELS[Number(second ?? details?.level) || 0];
    const text = String(details?.message ?? third ?? '').slice(0, 2000);
    if (!text) return;
    into.console.push({ level: level ?? 'log', text });
    if (into.console.length > MAX_CONSOLE_LINES * 4) {
      into.console.splice(0, into.console.length - MAX_CONSOLE_LINES * 4);
    }
  });

  try {
    contents.debugger.attach('1.3');
    void contents.debugger.sendCommand('Network.enable');
    contents.debugger.on('message', (_event, method, params) => {
      const payload = params as { response?: { url?: string; status?: number }; type?: string; errorText?: string };
      if (method === 'Network.responseReceived' && payload.response) {
        into.network.push({
          url: String(payload.response.url ?? ''),
          status: Number(payload.response.status ?? 0),
          type: String(payload.type ?? 'Other'),
        });
      } else if (method === 'Network.loadingFailed') {
        // A request that never completed is the one worth having. A page that
        // renders empty because a fetch was refused looks, in a screenshot and
        // in the text, exactly like a page with nothing to show.
        into.network.push({ url: '', status: 0, type: String(payload.type ?? 'Other'), failed: payload.errorText });
      }
      if (into.network.length > MAX_NETWORK_ENTRIES * 4) {
        into.network.splice(0, into.network.length - MAX_NETWORK_ENTRIES * 4);
      }
    });
  } catch {
    // Traffic goes unrecorded and everything else still works. `network` says
    // so itself rather than returning an empty list that reads as silence.
  }
};

/** The page, made on first use. Never shown, and there is no code path that shows it. */
const ensurePage = (): Page => {
  if (page && !page.window.isDestroyed()) return page;

  const window = new BrowserWindow({
    ...DEFAULT_VIEWPORT,
    show: false,
    webPreferences: {
      partition: BROWSER_PARTITION,
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
      // No preload, so nothing of this application is reachable from a page
      // the agent was told to open. The visible panel's webview has the same
      // rule for the same reason.
      sandbox: true,
    },
  });

  const made: Page = { window, console: [], network: [] };
  collect(window.webContents, made);
  window.on('closed', () => {
    if (page === made) page = null;
  });

  page = made;
  return made;
};

/** Tears the page down, so a long-running app is not holding a renderer for nothing. */
export const closeAgentPage = (): void => {
  const current = page;
  page = null;
  if (!current || current.window.isDestroyed()) return;
  try {
    if (current.window.webContents.debugger.isAttached()) current.window.webContents.debugger.detach();
  } catch {
    // Already gone; the window is being destroyed either way.
  }
  current.window.destroy();
};

/** Whether a page has been made yet, for tests and for teardown. */
export const agentPageExists = (): boolean => page !== null && !page.window.isDestroyed();

/**
 * A selector or a string of text, as a JavaScript string literal.
 *
 * Everything interpolated into an expression goes through `JSON.stringify`
 * rather than being quoted by hand: it escapes quotes, backslashes and line
 * terminators, and it is the difference between a selector and an injection.
 */
const literal = (value: string): string => JSON.stringify(value);

/** Runs an expression in the page, with a deadline. */
const evaluate = async <T>(contents: WebContents, expression: string): Promise<T> =>
  (await Promise.race([
    contents.executeJavaScript(expression, true),
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error('The page did not answer in time.')), COMMAND_TIMEOUT_MS)
    ),
  ])) as T;

/**
 * Waits for a navigation to settle, so a read after a click sees the new page.
 *
 * Bounded, because a click that changes nothing fires no navigation at all and
 * this cannot wait forever for one that is not coming.
 */
const settle = (contents: WebContents): Promise<void> =>
  new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      contents.removeListener('did-stop-loading', finish);
      resolve();
    };
    contents.once('did-stop-loading', finish);
    setTimeout(finish, 2500);
  });

/** Finds an element and does something to it, or reports that it is not there. */
const onElement = async (
  contents: WebContents,
  selector: string,
  body: string
): Promise<{ found: boolean } | { error: string }> => {
  const found = await evaluate<boolean>(
    contents,
    `(() => { const el = document.querySelector(${literal(selector)}); if (!el) return false; ${body} return true; })()`
  );
  return found ? { found: true } : { error: `No element matched ${selector}` };
};

export async function runAgentPageCommand(command: BrowserCommand): Promise<AgentPageResult> {
  try {
    const current = ensurePage();
    const contents = current.window.webContents;

    switch (command.name) {
      case 'state':
        return { ok: true, data: { url: contents.getURL(), title: contents.getTitle() } };

      case 'read': {
        const target = command.selector ? `document.querySelector(${literal(command.selector)})` : 'document.body';
        const text = await evaluate<string | null>(
          contents,
          `(() => { const el = ${target}; return el ? (el.innerText || el.textContent || '') : null; })()`
        );
        if (text === null) return { ok: false, error: `No element matched ${command.selector}` };
        const limit = command.maxChars ?? MAX_READ_CHARS;
        return {
          ok: true,
          data: {
            url: contents.getURL(),
            title: contents.getTitle(),
            text: text.slice(0, limit),
            truncated: text.length > limit,
          },
        };
      }

      case 'screenshot': {
        const image = await contents.capturePage();
        if (image.isEmpty()) {
          // Said rather than returned as an empty string. A zero-byte
          // screenshot handed to a model is described as a blank page, and
          // "the page has not painted yet" is a different fact.
          return { ok: false, error: 'The page has not painted anything yet. Navigate or wait for an element first.' };
        }
        return { ok: true, data: { pngBase64: image.toPNG().toString('base64'), url: contents.getURL() } };
      }

      case 'waitFor': {
        const deadline = Date.now() + (command.timeoutMs ?? DEFAULT_WAIT_MS);
        while (Date.now() < deadline) {
          const there = await evaluate<boolean>(
            contents,
            `document.querySelector(${literal(command.selector)}) !== null`
          );
          if (there) return { ok: true, data: { appeared: true, url: contents.getURL(), title: contents.getTitle() } };
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        // A timeout is an answer about the page, not an empty result. Reported
        // as a failure so it cannot be read as "the element is there and says
        // nothing".
        return {
          ok: false,
          error: `${command.selector} did not appear within ${command.timeoutMs ?? DEFAULT_WAIT_MS}ms. The page is at ${contents.getURL()}.`,
        };
      }

      case 'console': {
        const wanted = command.onlyErrors ? current.console.filter((line) => line.level === 'error') : current.console;
        const lines = wanted.slice(-(command.limit ?? MAX_CONSOLE_LINES));
        return {
          ok: true,
          data: {
            lines,
            note:
              lines.length === 0
                ? 'This page has logged nothing.'
                : `${lines.length} of ${current.console.length} lines.`,
          },
        };
      }

      case 'network': {
        const pattern = command.urlPattern?.toLowerCase();
        const matching = pattern
          ? current.network.filter((entry) => entry.url.toLowerCase().includes(pattern))
          : current.network;
        const entries = matching.slice(-(command.limit ?? MAX_NETWORK_ENTRIES));
        return {
          ok: true,
          data: {
            entries,
            failures: entries.filter((entry) => entry.failed || entry.status >= 400).length,
            note: entries.length === 0 ? 'Nothing has been requested by this page yet.' : `${entries.length} requests.`,
          },
        };
      }

      case 'navigate': {
        // Resolved by the same rule as the address bar, which refuses `file://`
        // — this must not become a reader for the machine's own disk.
        const target = resolveBrowserInput(command.url);
        await contents.loadURL(target);
        return { ok: true, data: { url: contents.getURL(), title: contents.getTitle() } };
      }

      case 'back':
      case 'forward': {
        const history = contents.navigationHistory;
        const canGo = command.name === 'back' ? history.canGoBack() : history.canGoForward();
        if (!canGo) return { ok: false, error: `Cannot go ${command.name} from here` };
        if (command.name === 'back') history.goBack();
        else history.goForward();
        await settle(contents);
        return { ok: true, data: { url: contents.getURL() } };
      }

      case 'click': {
        const result = await onElement(contents, command.selector, 'el.click();');
        if ('error' in result) return { ok: false, error: result.error };
        await settle(contents);
        return { ok: true, data: { url: contents.getURL(), title: contents.getTitle() } };
      }

      case 'type': {
        // The events matter: a framework-backed field ignores a value assigned
        // straight to `.value` and only updates when it hears `input`.
        const result = await onElement(
          contents,
          command.selector,
          `el.focus();
           el.value = ${literal(command.text)};
           el.dispatchEvent(new Event('input', { bubbles: true }));
           el.dispatchEvent(new Event('change', { bubbles: true }));
           ${command.submit ? 'if (el.form) { el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit(); }' : ''}`
        );
        if ('error' in result) return { ok: false, error: result.error };
        if (command.submit) await settle(contents);
        return { ok: true, data: { url: contents.getURL() } };
      }

      case 'scroll': {
        if (command.selector) {
          const result = await onElement(contents, command.selector, "el.scrollIntoView({ block: 'center' });");
          if ('error' in result) return { ok: false, error: result.error };
        } else {
          const by = (command.amount ?? 0) > 0 ? command.amount : undefined;
          await evaluate(
            contents,
            `window.scrollBy(0, ${command.direction === 'up' ? '-' : ''}${by ?? 'window.innerHeight * 0.9'});`
          );
        }
        // Half the web loads as you go, and the load is not instant.
        await new Promise((resolve) => setTimeout(resolve, 350));
        const position = await evaluate<{ y: number; height: number }>(
          contents,
          '({ y: Math.round(window.scrollY), height: Math.round(document.body ? document.body.scrollHeight : 0) })'
        );
        return { ok: true, data: { ...position, atBottom: position.y + DEFAULT_VIEWPORT.height >= position.height } };
      }

      case 'select': {
        const result = await onElement(
          contents,
          command.selector,
          `const wanted = ${literal(command.value)};
           const option = Array.from(el.options || []).find((o) => o.value === wanted || o.text.trim() === wanted);
           if (!option) return false;
           el.value = option.value;
           el.dispatchEvent(new Event('change', { bubbles: true }));`
        );
        if ('error' in result) {
          // Two different failures share one expression here, so the message
          // names both rather than claiming the field was missing.
          return {
            ok: false,
            error: `${command.selector} has no option matching "${command.value}", or is not there.`,
          };
        }
        return { ok: true, data: { selected: command.value } };
      }

      case 'press': {
        const key = command.key;
        const dispatch = `const opts = { key: ${literal(key)}, bubbles: true, cancelable: true };
           target.dispatchEvent(new KeyboardEvent('keydown', opts));
           target.dispatchEvent(new KeyboardEvent('keyup', opts));
           if (${literal(key)} === 'Enter' && target.form) { target.form.requestSubmit ? target.form.requestSubmit() : target.form.submit(); }`;
        if (command.selector) {
          const result = await onElement(contents, command.selector, `el.focus(); const target = el; ${dispatch}`);
          if ('error' in result) return { ok: false, error: result.error };
        } else {
          await evaluate(contents, `(() => { const target = document.activeElement || document.body; ${dispatch} })()`);
        }
        await settle(contents);
        return { ok: true, data: { pressed: key, url: contents.getURL() } };
      }

      case 'hover': {
        const result = await onElement(
          contents,
          command.selector,
          `for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
             el.dispatchEvent(new MouseEvent(type, { bubbles: type !== 'mouseenter', cancelable: true }));
           }`
        );
        if ('error' in result) return { ok: false, error: result.error };
        return { ok: true, data: { hovered: command.selector } };
      }

      case 'resize': {
        current.window.setSize(command.width, command.height);
        // The layout is a function of the viewport, and the viewport is what
        // the page reads. Reported back so a caller can see it took.
        const viewport = await evaluate<{ width: number; height: number }>(
          contents,
          '({ width: window.innerWidth, height: window.innerHeight })'
        );
        return { ok: true, data: viewport };
      }

      case 'evaluate': {
        const value = await evaluate<unknown>(
          contents,
          `(() => { const result = (${command.expression}); return typeof result === 'undefined' ? null : JSON.parse(JSON.stringify(result)); })()`
        );
        return { ok: true, data: { value } };
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
