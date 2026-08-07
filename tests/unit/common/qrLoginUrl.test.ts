/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isLoopbackUrl, qrLoginTarget } from '@/common/config/qrLoginUrl';

/**
 * The rule a QR code has to obey.
 *
 * A QR code is read by a *different* device, so an address that means "this
 * machine" is not merely unhelpful in one — it is guaranteed wrong, because on
 * the phone `localhost` means the phone. The panel used to fall back to exactly
 * that whenever there was no network address, producing a perfectly valid QR
 * code that could never work. "No matter what I do it will not connect" is the
 * accurate description of that.
 */
describe('qrLoginTarget', () => {
  const running = { running: true, allowRemote: true, networkUrl: 'http://192.168.0.6:25808' };

  it('points at the address another device can reach', () => {
    expect(qrLoginTarget(running, 'abc123')).toEqual({
      kind: 'ready',
      url: 'http://192.168.0.6:25808/qr-login?token=abc123',
    });
  });

  it('escapes a token rather than pasting it into the query raw', () => {
    const target = qrLoginTarget(running, 'a b&c=d');
    expect(target).toEqual({ kind: 'ready', url: 'http://192.168.0.6:25808/qr-login?token=a%20b%26c%3Dd' });
  });

  it('refuses when the server is not running', () => {
    expect(qrLoginTarget({ ...running, running: false }, 'abc123')).toEqual({ kind: 'refused', reason: 'not-running' });
  });

  it('refuses when remote access is off, because the port is bound to loopback', () => {
    expect(qrLoginTarget({ ...running, allowRemote: false }, 'abc123')).toEqual({
      kind: 'refused',
      reason: 'remote-off',
    });
  });

  it('refuses rather than falling back to a local address nobody else can reach', () => {
    expect(qrLoginTarget({ running: true, allowRemote: true, localUrl: 'http://localhost:25808' }, 'abc')).toEqual({
      kind: 'refused',
      reason: 'no-address',
    });
    expect(qrLoginTarget({ running: true, allowRemote: true, networkUrl: 'http://127.0.0.1:25808' }, 'abc')).toEqual({
      kind: 'refused',
      reason: 'no-address',
    });
  });

  it('does not double the slash when the address carries a trailing one', () => {
    expect(qrLoginTarget({ ...running, networkUrl: 'http://192.168.0.6:25808/' }, 'abc')).toEqual({
      kind: 'ready',
      url: 'http://192.168.0.6:25808/qr-login?token=abc',
    });
  });
});

describe('isLoopbackUrl', () => {
  it.each([
    'http://localhost:25808',
    'http://127.0.0.1:25808',
    'http://127.1.2.3:80',
    'http://[::1]:25808',
    'http://0.0.0.0:25808',
  ])('knows %s means the device that asked', (url) => {
    expect(isLoopbackUrl(url)).toBe(true);
  });

  it.each(['http://192.168.0.6:25808', 'http://10.0.0.4:25808', 'https://example.com'])(
    'knows %s can be reached from elsewhere',
    (url) => {
      expect(isLoopbackUrl(url)).toBe(false);
    }
  );

  it('is not fooled by something that is not a URL at all', () => {
    expect(isLoopbackUrl('localhost:25808')).toBe(false);
    expect(isLoopbackUrl('')).toBe(false);
  });
});
