/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The polyfill lives inline in index.html because it has to be installed before
 * the bundle is parsed — the first crypto.randomUUID call happens during module
 * evaluation, and if it throws there, nothing mounts.
 *
 * These tests run the real snippet out of the real file rather than a copy, so
 * deleting or breaking it fails here instead of on someone's phone.
 */

const INDEX_HTML = join(process.cwd(), 'packages', 'desktop', 'src', 'renderer', 'index.html');

/** The inline script that installs the polyfill, lifted from index.html. */
function polyfillSource(): string {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const snippet = scripts.find((body) => body.includes('randomUUID'));

  if (!snippet) {
    throw new Error('index.html no longer contains the crypto.randomUUID polyfill');
  }

  return snippet;
}

type FakeCrypto = {
  getRandomValues?: (array: Uint8Array) => Uint8Array;
  randomUUID?: () => string;
};

/** Runs the snippet against a stand-in crypto and hands back what it left behind. */
function install(cryptoStub: FakeCrypto | undefined): FakeCrypto | undefined {
  const run = new Function('crypto', `${polyfillSource()}\nreturn crypto;`) as (
    stub: FakeCrypto | undefined
  ) => FakeCrypto | undefined;

  return run(cryptoStub);
}

function insecureContextCrypto(): FakeCrypto {
  // What a browser exposes over plain HTTP on a LAN address: random bytes, but
  // no randomUUID and no subtle.
  return {
    getRandomValues: (array: Uint8Array) => {
      for (let i = 0; i < array.length; i += 1) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    },
  };
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('crypto.randomUUID polyfill', () => {
  it('defines randomUUID when the page is not a secure context', () => {
    const stub = install(insecureContextCrypto());

    expect(typeof stub?.randomUUID).toBe('function');
  });

  it('produces a well-formed version 4 UUID', () => {
    const stub = install(insecureContextCrypto());

    expect(stub?.randomUUID?.()).toMatch(UUID_V4);
  });

  it('does not repeat itself', () => {
    const stub = install(insecureContextCrypto());
    const seen = new Set(Array.from({ length: 500 }, () => stub?.randomUUID?.()));

    expect(seen.size).toBe(500);
  });

  it('leaves a real implementation alone', () => {
    const native = () => 'native-value';
    const stub = install({ ...insecureContextCrypto(), randomUUID: native });

    expect(stub?.randomUUID).toBe(native);
  });

  it('stays silent when there is no crypto at all', () => {
    expect(() => install(undefined)).not.toThrow();
  });

  it('stays silent when random bytes are unavailable', () => {
    const stub = install({});

    expect(stub?.randomUUID).toBeUndefined();
  });
});
