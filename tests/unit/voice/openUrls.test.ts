/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { MAX_URLS_PER_CALL, parseOpenUrls } from '@/common/realtime/openUrls';

/**
 * Reading a list of addresses out of whatever the model actually sent.
 *
 * The request this exists for is "find me the best mods for this game, list
 * them, and open each one in my browser" — several pages, in the order they
 * were read out, from one call rather than one call per tab.
 *
 * Every character of the argument was written by a language model, so the shape
 * is read generously and the contents strictly: a small local model will send a
 * bare string where the schema says array, several addresses inside one string,
 * or the same page twice, and failing the call for it means the user watches
 * nothing happen while being told it was done.
 */
describe('parseOpenUrls', () => {
  it('keeps a list in the order it was given', () => {
    expect(parseOpenUrls(['https://a.example/1', 'https://b.example/2'])).toEqual([
      'https://a.example/1',
      'https://b.example/2',
    ]);
  });

  it('accepts a bare string, which is what the schema does not say and models send anyway', () => {
    expect(parseOpenUrls('https://a.example/1')).toEqual(['https://a.example/1']);
  });

  it('splits several addresses out of one string', () => {
    expect(parseOpenUrls('https://a.example/1, https://b.example/2')).toEqual([
      'https://a.example/1',
      'https://b.example/2',
    ]);
  });

  it('drops the sentence punctuation left clinging to an address', () => {
    expect(parseOpenUrls(['https://a.example/mod.', 'https://b.example/mod)'])).toEqual([
      'https://a.example/mod',
      'https://b.example/mod',
    ]);
  });

  it('opens the same page once, however many times it was listed', () => {
    expect(parseOpenUrls(['https://a.example/1', 'https://a.example/1'])).toEqual(['https://a.example/1']);
  });

  /**
   * `openExternal` hands anything to whatever the system registered for the
   * scheme, and this argument comes from a model. Only the web gets through.
   */
  it.each([
    'file:///C:/Windows/System32/cmd.exe',
    'javascript:alert(1)',
    'mailto:someone@example.com',
    'steam://run/1817070',
    'not a url at all',
    '',
  ])('refuses anything that is not a web address: %j', (value) => {
    expect(parseOpenUrls(value)).toEqual([]);
  });

  it('keeps a web address that merely mentions another scheme in its query', () => {
    expect(parseOpenUrls('https://example.com/?next=file:///etc')).toEqual(['https://example.com/?next=file:///etc']);
  });

  /**
   * A model that has just summarised a page of search results can hand back
   * forty, and forty windows arriving at once is indistinguishable from the app
   * malfunctioning.
   */
  it('stops at the cap rather than filling the screen with windows', () => {
    const many = Array.from({ length: 40 }, (_, index) => `https://example.com/${index}`);

    expect(parseOpenUrls(many)).toHaveLength(MAX_URLS_PER_CALL);
    expect(parseOpenUrls(many)[0]).toBe('https://example.com/0');
  });

  it('has nothing to open for a shape that carries no addresses', () => {
    expect(parseOpenUrls(undefined)).toEqual([]);
    expect(parseOpenUrls({ url: 'https://example.com' })).toEqual([]);
    expect(parseOpenUrls(42)).toEqual([]);
  });
});
