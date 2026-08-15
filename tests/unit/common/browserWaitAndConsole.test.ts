/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two commands that turn browser automation from guessing into checking.
 *
 * Without `waitFor`, every sequence is click-hope-read: the page is read as it
 * was a moment before it finished, and whatever was on screen at that instant
 * is reported as the result. Without `console`, a screenshot of a broken page
 * is indistinguishable from a screenshot of a working one.
 *
 * `screenshot` needed neither — it had been implemented in this contract and in
 * the renderer's controller the whole time, and no MCP tool ever advertised it.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WAIT_MS,
  isReadCommand,
  MAX_CONSOLE_LINES,
  MAX_WAIT_MS,
  parseBrowserCommand,
  parseFailed,
  commandActsOnPage,
} from '@/common/browser/browserCommands';

const parse = (payload: unknown) => parseBrowserCommand(payload);

describe('waitFor', () => {
  it('takes a selector and a timeout', () => {
    const result = parse({ name: 'waitFor', selector: '#done', timeoutMs: 5000 });
    expect(parseFailed(result)).toBe(false);
    if (!parseFailed(result)) {
      expect(result.command).toEqual({ name: 'waitFor', selector: '#done', timeoutMs: 5000 });
    }
  });

  it('waits a sensible default when nobody said how long', () => {
    const result = parse({ name: 'waitFor', selector: '#done' });
    if (!parseFailed(result) && result.command.name === 'waitFor') {
      expect(result.command.timeoutMs).toBe(DEFAULT_WAIT_MS);
    }
  });

  it('caps a timeout rather than letting a turn hang on one', () => {
    // A model that asks to wait ten minutes has stopped the conversation, and
    // from where the user sits that is indistinguishable from a crash.
    const result = parse({ name: 'waitFor', selector: '#done', timeoutMs: 600_000 });
    if (!parseFailed(result) && result.command.name === 'waitFor') {
      expect(result.command.timeoutMs).toBe(MAX_WAIT_MS);
    }
  });

  it('refuses a wait with nothing to wait for', () => {
    expect(parseFailed(parse({ name: 'waitFor' }))).toBe(true);
    expect(parseFailed(parse({ name: 'waitFor', selector: '' }))).toBe(true);
  });

  it('is a read, so it needs no more permission than looking does', () => {
    expect(isReadCommand('waitFor')).toBe(true);
    expect(commandActsOnPage('waitFor')).toBe(false);
  });
});

describe('console', () => {
  it('reads everything by default and errors when asked', () => {
    const all = parse({ name: 'console' });
    if (!parseFailed(all) && all.command.name === 'console') {
      expect(all.command.onlyErrors).toBe(false);
      expect(all.command.limit).toBe(MAX_CONSOLE_LINES);
    }

    const errors = parse({ name: 'console', onlyErrors: true, limit: 10 });
    if (!parseFailed(errors) && errors.command.name === 'console') {
      expect(errors.command).toEqual({ name: 'console', onlyErrors: true, limit: 10 });
    }
  });

  it('caps how much of a logging loop can come back at once', () => {
    const result = parse({ name: 'console', limit: 100_000 });
    if (!parseFailed(result) && result.command.name === 'console') {
      expect(result.command.limit).toBe(MAX_CONSOLE_LINES);
    }
  });

  it('refuses arguments of the wrong shape rather than coercing them', () => {
    expect(parseFailed(parse({ name: 'console', onlyErrors: 'yes' }))).toBe(true);
    expect(parseFailed(parse({ name: 'console', limit: -1 }))).toBe(true);
  });

  it('is a read: looking at what a page logged changes nothing', () => {
    expect(isReadCommand('console')).toBe(true);
    expect(commandActsOnPage('console')).toBe(false);
  });
});

describe('screenshot', () => {
  it('is a read of the page under test, not an action on it', () => {
    expect(isReadCommand('screenshot')).toBe(true);
    expect(commandActsOnPage('screenshot')).toBe(false);
    expect(parseFailed(parse({ name: 'screenshot' }))).toBe(false);
  });
});
