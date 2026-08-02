/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What an agent is allowed to ask the in-app browser to do.
 *
 * This file is the contract and nothing else: no Electron, no HTTP, no webview.
 * Every layer between the agent and the page — the MCP server, the control
 * endpoint in the main process, the controller in the renderer — validates
 * against these definitions rather than against its own idea of them, so a
 * command cannot mean one thing at the edge and another by the time it lands.
 *
 * The browser being driven is the one the user can see, running in the
 * `persist:fool-browser` partition. It keeps their logins. That is the whole
 * value of driving it rather than a fresh headless one, and it is also why
 * `act` commands are separated from `read` ones below: the difference between
 * looking at a signed-in page and pressing a button on it is the difference the
 * user cares about, so it is a property of the command rather than a judgement
 * made later.
 */

/** Commands that only observe. They cannot change anything on the page. */
export const READ_COMMANDS = ['state', 'read', 'screenshot'] as const;

/** Commands that change what the page or the browser is doing. */
export const ACT_COMMANDS = ['navigate', 'click', 'type', 'back', 'forward'] as const;

export type ReadCommand = (typeof READ_COMMANDS)[number];
export type ActCommand = (typeof ACT_COMMANDS)[number];
export type BrowserCommandName = ReadCommand | ActCommand;

export type BrowserCommand =
  /** Where the browser is: current URL and page title. */
  | { name: 'state' }
  /** The page's visible text, for reading rather than scraping markup. */
  | { name: 'read'; selector?: string; maxChars?: number }
  /** A PNG of the visible page. */
  | { name: 'screenshot' }
  /** Go to a page. The input is resolved the same way the address bar resolves it. */
  | { name: 'navigate'; url: string }
  | { name: 'click'; selector: string }
  | { name: 'type'; selector: string; text: string; submit?: boolean }
  | { name: 'back' }
  | { name: 'forward' };

/** How much page text one `read` may return before it is truncated. */
export const MAX_READ_CHARS = 40_000;
/** A selector long enough to be a real one and short enough not to be a payload. */
const MAX_SELECTOR_LENGTH = 512;
/** Room for an address, a search phrase, or a form field's worth of text. */
const MAX_TEXT_LENGTH = 8_192;

export const isReadCommand = (name: string): name is ReadCommand => (READ_COMMANDS as readonly string[]).includes(name);

export const isActCommand = (name: string): name is ActCommand => (ACT_COMMANDS as readonly string[]).includes(name);

/**
 * Whether running this command needs the user's say-so beyond starting the
 * browser at all.
 *
 * Reading a page the user already has open is the browser doing what it looks
 * like it is doing. Pressing a button on a site they are signed into is acting
 * as them, and is treated as such wherever this is consulted.
 */
export const commandActsOnPage = (name: string): boolean => isActCommand(name);

export type ParseSuccess = { ok: true; command: BrowserCommand };
export type ParseFailure = { ok: false; error: string };
export type ParseResult = ParseSuccess | ParseFailure;

/**
 * Narrowing helpers rather than bare `if (!result.ok)`.
 *
 * This project compiles without `strictNullChecks`, and without it TypeScript
 * does not narrow a union by a boolean discriminant — `result.error` after
 * `!result.ok` is an error, not a string. A user-defined type guard narrows in
 * either mode, so the check is written once here instead of being worked around
 * at each call site.
 */
export const parseFailed = (result: ParseResult): result is ParseFailure => !result.ok;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A checked string, kept separate from {@link ParseResult} so neither type's
 * narrowing depends on the other's shape. */
type StringFailure = { ok: false; error: string };
type StringResult = { ok: true; value: string } | StringFailure;

const stringFailed = (result: StringResult): result is StringFailure => !result.ok;

const readString = (value: unknown, field: string, maxLength: number): StringResult => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, error: `"${field}" must be a non-empty string` };
  }
  if (value.length > maxLength) {
    return { ok: false, error: `"${field}" must be at most ${maxLength} characters` };
  }
  return { ok: true, value };
};

/**
 * Turn an untrusted payload into a command, or explain why it is not one.
 *
 * Deliberately strict about the shape rather than forgiving: this is the edge a
 * model's output arrives at, and a command that is half-understood is worse
 * than one that is refused with a reason the model can read and correct.
 */
export function parseBrowserCommand(payload: unknown): ParseResult {
  if (!isRecord(payload)) return { ok: false, error: 'command must be an object' };

  const name = payload.name;
  if (typeof name !== 'string') return { ok: false, error: '"name" is required' };
  if (!isReadCommand(name) && !isActCommand(name)) {
    return { ok: false, error: `unknown command "${name}"` };
  }

  switch (name) {
    case 'state':
    case 'screenshot':
    case 'back':
    case 'forward':
      return { ok: true, command: { name } };

    case 'read': {
      const selector = payload.selector;
      if (selector !== undefined) {
        const parsed = readString(selector, 'selector', MAX_SELECTOR_LENGTH);
        if (stringFailed(parsed)) return parsed;
      }
      const maxChars = payload.maxChars;
      if (maxChars !== undefined && (typeof maxChars !== 'number' || !Number.isFinite(maxChars) || maxChars <= 0)) {
        return { ok: false, error: '"maxChars" must be a positive number' };
      }
      return {
        ok: true,
        command: {
          name,
          selector: typeof selector === 'string' ? selector : undefined,
          maxChars: typeof maxChars === 'number' ? Math.min(maxChars, MAX_READ_CHARS) : MAX_READ_CHARS,
        },
      };
    }

    case 'navigate': {
      const parsed = readString(payload.url, 'url', MAX_TEXT_LENGTH);
      if (stringFailed(parsed)) return parsed;
      return { ok: true, command: { name, url: parsed.value } };
    }

    case 'click': {
      const parsed = readString(payload.selector, 'selector', MAX_SELECTOR_LENGTH);
      if (stringFailed(parsed)) return parsed;
      return { ok: true, command: { name, selector: parsed.value } };
    }

    case 'type': {
      const selector = readString(payload.selector, 'selector', MAX_SELECTOR_LENGTH);
      if (stringFailed(selector)) return selector;
      const text = readString(payload.text, 'text', MAX_TEXT_LENGTH);
      if (stringFailed(text)) return text;
      if (payload.submit !== undefined && typeof payload.submit !== 'boolean') {
        return { ok: false, error: '"submit" must be a boolean' };
      }
      return {
        ok: true,
        command: { name, selector: selector.value, text: text.value, submit: payload.submit === true },
      };
    }
  }
}
