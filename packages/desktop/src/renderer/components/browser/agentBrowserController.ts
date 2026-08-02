/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserCommand } from '@/common/browser/browserCommands';
import { MAX_READ_CHARS } from '@/common/browser/browserCommands';
import { resolveBrowserInput } from './browserSession';

/**
 * Running a command against the in-app browser.
 *
 * The webview lives in a React component; an agent's command arrives from the
 * main process, which has no reference to it. So the panel registers its
 * webview here when it mounts, and this module is the one place that knows how
 * to work it.
 *
 * Everything reaching a page goes through `executeJavaScript`, which returns
 * whatever the expression evaluates to. The expressions below are written to
 * return a plain, serialisable answer rather than a DOM node — a node cannot
 * cross that boundary and would arrive as `undefined`, which reads exactly like
 * "the element was not found" and is not the same thing at all.
 */

export type BrowserCommandResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

/** The webview the panel is showing, or null when the panel has never opened. */
let webview: Electron.WebviewTag | null = null;

/** Called by the panel as its webview appears and disappears. */
export function registerAgentBrowserWebview(element: Electron.WebviewTag | null): void {
  webview = element;
}

/** Whether there is a browser to drive at all. */
export function isAgentBrowserAvailable(): boolean {
  return webview !== null;
}

/**
 * A selector, as a JavaScript string literal.
 *
 * The selector comes from a model and is interpolated into an expression, so it
 * is quoted through `JSON.stringify` rather than by hand: that escapes quotes,
 * backslashes and line terminators, and is the difference between a selector
 * and an injection.
 */
const literal = (value: string): string => JSON.stringify(value);

/** Waits for a navigation to settle, so a read after a click sees the new page. */
const settle = (element: Electron.WebviewTag): Promise<void> =>
  new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      element.removeEventListener('did-stop-loading', finish);
      resolve();
    };
    element.addEventListener('did-stop-loading', finish);
    // A click that changes nothing fires no navigation event at all, so this
    // cannot wait indefinitely for one.
    setTimeout(finish, 2500);
  });

export async function runAgentBrowserCommand(command: BrowserCommand): Promise<BrowserCommandResult> {
  const element = webview;
  if (!element) {
    return { ok: false, error: 'The in-app browser is not open. Ask the user to open it, then try again.' };
  }

  try {
    switch (command.name) {
      case 'state':
        return {
          ok: true,
          data: {
            url: element.getURL(),
            title: element.getTitle(),
          },
        };

      case 'read': {
        const selector = command.selector ? literal(command.selector) : null;
        const target = selector ? `document.querySelector(${selector})` : 'document.body';
        const text = (await element.executeJavaScript(
          `(() => { const el = ${target}; return el ? (el.innerText || el.textContent || '') : null; })()`
        )) as string | null;

        if (text === null) {
          return { ok: false, error: `No element matched ${command.selector}` };
        }
        const limit = command.maxChars ?? MAX_READ_CHARS;
        return {
          ok: true,
          data: {
            url: element.getURL(),
            title: element.getTitle(),
            text: text.slice(0, limit),
            truncated: text.length > limit,
          },
        };
      }

      case 'screenshot': {
        const image = await element.capturePage();
        return { ok: true, data: { pngBase64: image.toPNG().toString('base64') } };
      }

      case 'navigate': {
        // Resolved by the same rule as the address bar, which refuses `file://`
        // — an agent must not be able to turn this into a reader for the disk.
        const target = resolveBrowserInput(command.url);
        await element.loadURL(target);
        return { ok: true, data: { url: target } };
      }

      case 'back':
      case 'forward': {
        const canGo = command.name === 'back' ? element.canGoBack() : element.canGoForward();
        if (!canGo) return { ok: false, error: `Cannot go ${command.name} from here` };
        if (command.name === 'back') element.goBack();
        else element.goForward();
        await settle(element);
        return { ok: true, data: { url: element.getURL() } };
      }

      case 'click': {
        const found = (await element.executeJavaScript(
          `(() => { const el = document.querySelector(${literal(command.selector)}); if (!el) return false; el.click(); return true; })()`
        )) as boolean;
        if (!found) return { ok: false, error: `No element matched ${command.selector}` };
        await settle(element);
        return { ok: true, data: { url: element.getURL(), title: element.getTitle() } };
      }

      case 'type': {
        // The events matter: a framework-backed field ignores a value assigned
        // straight to `.value` and only updates when it hears `input`.
        const found = (await element.executeJavaScript(
          `(() => {
             const el = document.querySelector(${literal(command.selector)});
             if (!el) return false;
             el.focus();
             el.value = ${literal(command.text)};
             el.dispatchEvent(new Event('input', { bubbles: true }));
             el.dispatchEvent(new Event('change', { bubbles: true }));
             ${command.submit ? 'if (el.form) el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();' : ''}
             return true;
           })()`
        )) as boolean;
        if (!found) return { ok: false, error: `No element matched ${command.selector}` };
        if (command.submit) await settle(element);
        return { ok: true, data: { url: element.getURL() } };
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
