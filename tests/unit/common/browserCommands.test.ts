/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  ACT_COMMANDS,
  commandActsOnPage,
  MAX_NETWORK_ENTRIES,
  MAX_READ_CHARS,
  MAX_VIEWPORT_PX,
  MIN_VIEWPORT_PX,
  parseBrowserCommand,
  READ_COMMANDS,
} from '@/common/browser/browserCommands';

/**
 * The browser being driven keeps the user's logins, so "did this only look, or
 * did it press something" is the distinction the whole design rests on.
 */
describe('commandActsOnPage', () => {
  it.each([...READ_COMMANDS])('treats %s as observation', (name) => {
    expect(commandActsOnPage(name)).toBe(false);
  });

  it.each([...ACT_COMMANDS])('treats %s as acting', (name) => {
    expect(commandActsOnPage(name)).toBe(true);
  });

  it('does not treat an unknown command as safe', () => {
    // An unrecognised name is not an act command, but it is also never executed
    // — parse refuses it first. This pins that it cannot slip through as a read.
    expect(parseBrowserCommand({ name: 'telepathy' })).toEqual({ ok: false, error: 'unknown command "telepathy"' });
  });

  it('treats evaluating a script as acting, not as reading', () => {
    // `evaluate` is named for what the caller wants — a value back — but the
    // expression runs with the page's own authority on a site the user is
    // signed into. Classifying it by intent rather than by power is how a
    // "read-only" script ends up submitting a form.
    expect(commandActsOnPage('evaluate')).toBe(true);
  });
});

describe('parseBrowserCommand', () => {
  it('refuses anything that is not an object', () => {
    for (const payload of [null, undefined, 'navigate', 42, []]) {
      expect(parseBrowserCommand(payload).ok).toBe(false);
    }
  });

  it('requires a name', () => {
    expect(parseBrowserCommand({})).toEqual({ ok: false, error: '"name" is required' });
  });

  it('accepts the commands that take no arguments', () => {
    for (const name of ['state', 'screenshot', 'back', 'forward'] as const) {
      expect(parseBrowserCommand({ name })).toEqual({ ok: true, command: { name } });
    }
  });

  describe('navigate', () => {
    it('accepts a url', () => {
      expect(parseBrowserCommand({ name: 'navigate', url: 'example.com' })).toEqual({
        ok: true,
        command: { name: 'navigate', url: 'example.com' },
      });
    });

    it('refuses a missing or empty url', () => {
      expect(parseBrowserCommand({ name: 'navigate' }).ok).toBe(false);
      expect(parseBrowserCommand({ name: 'navigate', url: '   ' }).ok).toBe(false);
    });
  });

  describe('read', () => {
    it('defaults to the maximum when no limit is given', () => {
      expect(parseBrowserCommand({ name: 'read' })).toEqual({
        ok: true,
        command: { name: 'read', selector: undefined, maxChars: MAX_READ_CHARS },
      });
    });

    it('caps a request for more than the maximum', () => {
      const parsed = parseBrowserCommand({ name: 'read', maxChars: MAX_READ_CHARS * 10 });

      expect(parsed).toMatchObject({ ok: true, command: { maxChars: MAX_READ_CHARS } });
    });

    it('keeps a smaller limit', () => {
      expect(parseBrowserCommand({ name: 'read', maxChars: 100 })).toMatchObject({
        ok: true,
        command: { maxChars: 100 },
      });
    });

    it('refuses a nonsensical limit', () => {
      for (const maxChars of [0, -1, Number.NaN, 'lots']) {
        expect(parseBrowserCommand({ name: 'read', maxChars }).ok).toBe(false);
      }
    });
  });

  describe('click', () => {
    it('requires a selector', () => {
      expect(parseBrowserCommand({ name: 'click' }).ok).toBe(false);
      expect(parseBrowserCommand({ name: 'click', selector: 'button.submit' })).toEqual({
        ok: true,
        command: { name: 'click', selector: 'button.submit' },
      });
    });

    it('refuses a selector long enough to be a payload rather than a selector', () => {
      expect(parseBrowserCommand({ name: 'click', selector: 'a'.repeat(5000) }).ok).toBe(false);
    });
  });

  describe('type', () => {
    it('requires both a selector and text, and defaults to not submitting', () => {
      expect(parseBrowserCommand({ name: 'type', selector: '#q', text: 'hello' })).toEqual({
        ok: true,
        command: { name: 'type', selector: '#q', text: 'hello', submit: false },
      });
    });

    it('carries an explicit submit', () => {
      expect(parseBrowserCommand({ name: 'type', selector: '#q', text: 'hello', submit: true })).toMatchObject({
        ok: true,
        command: { submit: true },
      });
    });

    it('refuses a non-boolean submit rather than guessing what was meant', () => {
      expect(parseBrowserCommand({ name: 'type', selector: '#q', text: 'hi', submit: 'yes' }).ok).toBe(false);
    });

    it('refuses missing pieces', () => {
      expect(parseBrowserCommand({ name: 'type', selector: '#q' }).ok).toBe(false);
      expect(parseBrowserCommand({ name: 'type', text: 'hello' }).ok).toBe(false);
    });
  });

  describe('scroll', () => {
    it('scrolls down by default, because that is what reading a page means', () => {
      expect(parseBrowserCommand({ name: 'scroll' })).toEqual({
        ok: true,
        command: { name: 'scroll', selector: undefined, direction: 'down', amount: undefined },
      });
    });

    it('takes an element to scroll to', () => {
      expect(parseBrowserCommand({ name: 'scroll', selector: 'footer' })).toMatchObject({
        ok: true,
        command: { selector: 'footer' },
      });
    });

    it('refuses a direction that is neither way', () => {
      expect(parseBrowserCommand({ name: 'scroll', direction: 'sideways' }).ok).toBe(false);
    });
  });

  describe('select', () => {
    it('needs both the field and the option', () => {
      expect(parseBrowserCommand({ name: 'select', selector: '#country', value: 'TR' })).toEqual({
        ok: true,
        command: { name: 'select', selector: '#country', value: 'TR' },
      });
      expect(parseBrowserCommand({ name: 'select', selector: '#country' }).ok).toBe(false);
    });
  });

  describe('press', () => {
    it('needs a key and will take an element to press it at', () => {
      expect(parseBrowserCommand({ name: 'press', key: 'Enter' })).toEqual({
        ok: true,
        command: { name: 'press', key: 'Enter', selector: undefined },
      });
      expect(parseBrowserCommand({ name: 'press', key: 'Enter', selector: '#q' })).toMatchObject({
        ok: true,
        command: { selector: '#q' },
      });
    });

    it('refuses a key name long enough to be something else', () => {
      expect(parseBrowserCommand({ name: 'press', key: 'a'.repeat(200) }).ok).toBe(false);
    });
  });

  describe('resize', () => {
    it('takes a viewport to check a layout at', () => {
      expect(parseBrowserCommand({ name: 'resize', width: 375, height: 812 })).toEqual({
        ok: true,
        command: { name: 'resize', width: 375, height: 812 },
      });
    });

    it('clamps rather than refuses, because the request was still understood', () => {
      // "Check it on a big screen" with a number nobody measured is the same
      // request as one with a number somebody did.
      expect(parseBrowserCommand({ name: 'resize', width: 99_999, height: 10 })).toMatchObject({
        ok: true,
        command: { width: MAX_VIEWPORT_PX, height: MIN_VIEWPORT_PX },
      });
    });

    it('refuses a viewport with a side missing', () => {
      expect(parseBrowserCommand({ name: 'resize', width: 800 }).ok).toBe(false);
    });
  });

  describe('network', () => {
    it('defaults to the whole log, capped', () => {
      expect(parseBrowserCommand({ name: 'network' })).toEqual({
        ok: true,
        command: { name: 'network', urlPattern: undefined, limit: MAX_NETWORK_ENTRIES },
      });
    });

    it('caps a request for more than the maximum', () => {
      expect(parseBrowserCommand({ name: 'network', limit: 10_000 })).toMatchObject({
        ok: true,
        command: { limit: MAX_NETWORK_ENTRIES },
      });
    });
  });

  describe('evaluate', () => {
    it('needs an expression', () => {
      expect(parseBrowserCommand({ name: 'evaluate', expression: 'document.title' })).toEqual({
        ok: true,
        command: { name: 'evaluate', expression: 'document.title' },
      });
      expect(parseBrowserCommand({ name: 'evaluate' }).ok).toBe(false);
    });

    it('refuses an expression long enough to be a program', () => {
      expect(parseBrowserCommand({ name: 'evaluate', expression: 'x'.repeat(9000) }).ok).toBe(false);
    });
  });
});
