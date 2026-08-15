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
export const READ_COMMANDS = ['state', 'read', 'screenshot', 'waitFor', 'console', 'network'] as const;

/**
 * Commands that change what the page or the browser is doing.
 *
 * `scroll` and `resize` are here rather than above, and the reason is not
 * pedantry: scrolling fires lazy-loading and intersection observers, and
 * resizing re-runs media queries. Both change what the page is doing, which is
 * what this list is for.
 *
 * `evaluate` is here because of what it can do rather than what it is usually
 * for. The expression runs with the page's own authority on a site the user is
 * signed into; classifying it by the caller's intention is how a script that
 * was going to "just read a value" ends up submitting a form.
 */
export const ACT_COMMANDS = [
  'navigate',
  'click',
  'type',
  'back',
  'forward',
  'scroll',
  'select',
  'press',
  'hover',
  'resize',
  'evaluate',
] as const;

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
  /**
   * Waits for something to appear before carrying on.
   *
   * Without this every automation is a guess about timing: click, hope, read,
   * and report whatever the page happened to be showing. A timeout is answered
   * as a timeout — "that never appeared" is a fact about the page, and it must
   * not be reported as an empty result.
   */
  | { name: 'waitFor'; selector: string; timeoutMs?: number }
  /**
   * What the page logged, including its errors.
   *
   * The other half of verifying a page actually works: a screenshot of a broken
   * app looks like a screenshot of a working one, and the difference is usually
   * sitting in the console.
   */
  | { name: 'console'; onlyErrors?: boolean; limit?: number }
  /**
   * What the page asked the network for, and what came back.
   *
   * A page that renders empty because one request 500'd looks, in a screenshot
   * and in the text, exactly like a page with nothing to show. The difference
   * is here.
   */
  | { name: 'network'; urlPattern?: string; limit?: number }
  /** Go to a page. The input is resolved the same way the address bar resolves it. */
  | { name: 'navigate'; url: string }
  | { name: 'click'; selector: string }
  | { name: 'type'; selector: string; text: string; submit?: boolean }
  | { name: 'back' }
  | { name: 'forward' }
  /**
   * Move the page, either to an element or by a screenful.
   *
   * Half the web loads as you go. Reading a long page without this returns the
   * first screen and a confident summary of an article whose body never
   * rendered.
   */
  | { name: 'scroll'; selector?: string; direction?: 'up' | 'down'; amount?: number }
  /** Choose an option in a `<select>`, by value or by visible label. */
  | { name: 'select'; selector: string; value: string }
  /**
   * Press a key, at an element or wherever the focus is.
   *
   * Enter, Escape, Tab and the arrows are how a real form is completed; a
   * click on a submit button is only the last of them, and plenty of pages
   * have no button to click at all.
   */
  | { name: 'press'; key: string; selector?: string }
  /** Hover, for menus and tooltips that exist only while the pointer is on them. */
  | { name: 'hover'; selector: string }
  /** Resize the viewport, which is how a layout is checked at another width. */
  | { name: 'resize'; width: number; height: number }
  /**
   * Evaluate an expression in the page and return what it produced.
   *
   * The escape hatch, and described as one wherever it is offered: it is for
   * reading a value the other commands cannot reach, not for changing a page.
   * A UI change belongs in the source, where it survives a reload.
   */
  | { name: 'evaluate'; expression: string };

/** How much page text one `read` may return before it is truncated. */
export const MAX_READ_CHARS = 40_000;
/** How long a `waitFor` may hold a turn open. */
export const MAX_WAIT_MS = 30_000;
/** What a `waitFor` waits when nobody said. Long enough for a page load. */
export const DEFAULT_WAIT_MS = 10_000;
/** How many console lines one call may return. */
export const MAX_CONSOLE_LINES = 200;
/** How many network entries one call may return. */
export const MAX_NETWORK_ENTRIES = 200;
/**
 * The largest viewport a resize may ask for.
 *
 * Wide enough for any layout worth checking and small enough that a mistyped
 * number cannot ask the compositor for a surface measured in gigabytes.
 */
export const MAX_VIEWPORT_PX = 4096;
/** The smallest viewport worth rendering. Below this nothing lays out. */
export const MIN_VIEWPORT_PX = 200;
/**
 * How long an expression may be.
 *
 * Long enough for a real query over the DOM, short enough that this is not a
 * way to ship a program into the page a character at a time.
 */
export const MAX_EXPRESSION_LENGTH = 4_096;
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

/**
 * An optional positive number, checked the same way everywhere.
 *
 * `undefined` is a success carrying no value rather than a failure: every one
 * of these fields has a default, and "not given" and "given as nonsense" are
 * different things a caller needs told apart.
 */
type NumberFailure = { ok: false; error: string };
type NumberResult = { ok: true; value: number | undefined } | NumberFailure;

const numberFailed = (result: NumberResult): result is NumberFailure => !result.ok;

const readPositive = (value: unknown, field: string): NumberResult => {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return { ok: false, error: `"${field}" must be a positive number` };
  }
  return { ok: true, value };
};

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

    case 'waitFor': {
      const parsed = readString(payload.selector, 'selector', MAX_SELECTOR_LENGTH);
      if (stringFailed(parsed)) return parsed;
      const timeoutMs = payload.timeoutMs;
      if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
        return { ok: false, error: '"timeoutMs" must be a positive number' };
      }
      return {
        ok: true,
        command: {
          name,
          selector: parsed.value,
          // Capped rather than trusted: a model that asks to wait ten minutes
          // has stopped the turn, and nobody watching can tell that from a hang.
          timeoutMs: typeof timeoutMs === 'number' ? Math.min(timeoutMs, MAX_WAIT_MS) : DEFAULT_WAIT_MS,
        },
      };
    }

    case 'console': {
      const limit = payload.limit;
      if (limit !== undefined && (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0)) {
        return { ok: false, error: '"limit" must be a positive number' };
      }
      if (payload.onlyErrors !== undefined && typeof payload.onlyErrors !== 'boolean') {
        return { ok: false, error: '"onlyErrors" must be a boolean' };
      }
      return {
        ok: true,
        command: {
          name,
          onlyErrors: payload.onlyErrors === true,
          limit: typeof limit === 'number' ? Math.min(limit, MAX_CONSOLE_LINES) : MAX_CONSOLE_LINES,
        },
      };
    }

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

    case 'network': {
      const urlPattern = payload.urlPattern;
      if (urlPattern !== undefined) {
        const parsed = readString(urlPattern, 'urlPattern', MAX_TEXT_LENGTH);
        if (stringFailed(parsed)) return parsed;
      }
      const limit = readPositive(payload.limit, 'limit');
      if (numberFailed(limit)) return limit;
      return {
        ok: true,
        command: {
          name,
          urlPattern: typeof urlPattern === 'string' ? urlPattern : undefined,
          limit: limit.value === undefined ? MAX_NETWORK_ENTRIES : Math.min(limit.value, MAX_NETWORK_ENTRIES),
        },
      };
    }

    case 'scroll': {
      const selector = payload.selector;
      if (selector !== undefined) {
        const parsed = readString(selector, 'selector', MAX_SELECTOR_LENGTH);
        if (stringFailed(parsed)) return parsed;
      }
      const direction = payload.direction;
      if (direction !== undefined && direction !== 'up' && direction !== 'down') {
        return { ok: false, error: '"direction" must be "up" or "down"' };
      }
      const amount = readPositive(payload.amount, 'amount');
      if (numberFailed(amount)) return amount;
      return {
        ok: true,
        command: {
          name,
          selector: typeof selector === 'string' ? selector : undefined,
          direction: direction === 'up' ? 'up' : 'down',
          amount: amount.value,
        },
      };
    }

    case 'select': {
      const selector = readString(payload.selector, 'selector', MAX_SELECTOR_LENGTH);
      if (stringFailed(selector)) return selector;
      const value = readString(payload.value, 'value', MAX_TEXT_LENGTH);
      if (stringFailed(value)) return value;
      return { ok: true, command: { name, selector: selector.value, value: value.value } };
    }

    case 'press': {
      const key = readString(payload.key, 'key', 64);
      if (stringFailed(key)) return key;
      const selector = payload.selector;
      if (selector !== undefined) {
        const parsed = readString(selector, 'selector', MAX_SELECTOR_LENGTH);
        if (stringFailed(parsed)) return parsed;
      }
      return {
        ok: true,
        command: { name, key: key.value, selector: typeof selector === 'string' ? selector : undefined },
      };
    }

    case 'hover': {
      const parsed = readString(payload.selector, 'selector', MAX_SELECTOR_LENGTH);
      if (stringFailed(parsed)) return parsed;
      return { ok: true, command: { name, selector: parsed.value } };
    }

    case 'resize': {
      const width = readPositive(payload.width, 'width');
      if (numberFailed(width)) return width;
      const height = readPositive(payload.height, 'height');
      if (numberFailed(height)) return height;
      if (width.value === undefined || height.value === undefined) {
        return { ok: false, error: '"width" and "height" are both required' };
      }
      // Clamped rather than refused. A model asking for a phone at 320px and a
      // desktop at 5000px is making the same request — check this layout at
      // that width — and the second one is only wrong by being outside what a
      // compositor will allocate.
      const clamp = (value: number): number => Math.min(Math.max(value, MIN_VIEWPORT_PX), MAX_VIEWPORT_PX);
      return { ok: true, command: { name, width: clamp(width.value), height: clamp(height.value) } };
    }

    case 'evaluate': {
      const parsed = readString(payload.expression, 'expression', MAX_EXPRESSION_LENGTH);
      if (stringFailed(parsed)) return parsed;
      return { ok: true, command: { name, expression: parsed.value } };
    }
  }
}
