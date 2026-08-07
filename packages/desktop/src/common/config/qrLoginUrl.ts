/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The address a QR code may carry, and the one it may never.
 *
 * A QR code is scanned by a *different device*. That is the entire point of one
 * — nobody photographs their own screen with the machine the screen belongs to.
 * So a loopback address inside a QR code is not merely unhelpful: it is
 * guaranteed wrong, because `localhost` on the phone means the phone.
 *
 * The reported failure was exactly that. Remote access is off by default, the
 * code that built the QR fell back to the local URL whenever it was off, and the
 * result was a perfectly valid QR code that could never work from any phone.
 * "No matter what I do it will not connect" is the correct description of it.
 *
 * Kept apart from the panel that draws it so the rule can be stated once and
 * tested without a browser: a QR is offered only when there is an address
 * another device can actually reach.
 */

/** Hosts that mean "this machine", and therefore mean the phone that scanned it. */
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0)$/i;

/** The host out of a URL, or an empty string when it is not one. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

/** Whether an address only ever resolves back to whatever device asked. */
export const isLoopbackUrl = (url: string): boolean => LOOPBACK.test(hostOf(url));

/**
 * Discriminated by a name rather than by a boolean on purpose: this project
 * does not compile with `strictNullChecks`, and without it a `true`/`false`
 * discriminant widens to `boolean` and narrows nothing at the call site.
 */
export type QrTarget =
  | { kind: 'ready'; url: string }
  /** No address another device could reach, and why. */
  | { kind: 'refused'; reason: 'not-running' | 'remote-off' | 'no-address' };

export type QrStatusInput = {
  running: boolean;
  allowRemote: boolean;
  /** The address on the local network, when the server is listening on one. */
  networkUrl?: string;
  localUrl?: string;
};

/**
 * The address to put in the QR code, or the reason there is not one.
 *
 * Deliberately refuses rather than falling back. A QR nobody can scan
 * successfully is worse than no QR at all: it looks like the feature working,
 * so the person tries it, fails, and has nothing to tell them why.
 */
export const qrLoginTarget = (status: QrStatusInput, token: string): QrTarget => {
  if (!status.running) return { kind: 'refused', reason: 'not-running' };
  if (!status.allowRemote) return { kind: 'refused', reason: 'remote-off' };

  const address = status.networkUrl ?? '';
  if (address.length === 0 || isLoopbackUrl(address)) return { kind: 'refused', reason: 'no-address' };

  return { kind: 'ready', url: `${address.replace(/\/+$/, '')}/qr-login?token=${encodeURIComponent(token)}` };
};
