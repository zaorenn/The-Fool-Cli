/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { shell } from 'electron';
import {
  buildAuthorizeUrl,
  expiryFrom,
  readAuthorizeCallback,
  redirectUriFor,
  SPOTIFY_REDIRECT_PORTS,
  SPOTIFY_SCOPES,
  SPOTIFY_TOKEN_ENDPOINT,
  tokenUsable,
  type SpotifyTokens,
} from '@/common/voice/spotifyAuth';
import { readConnection, writeConnection } from './store';

/**
 * The sign-in itself: a browser, a loopback port, and no password in this app.
 *
 * The user clicks Connect, their own browser opens Spotify's own page, they
 * answer it there, and Spotify redirects to a port this process is holding. The
 * application never renders a login form, never asks for a password, and never
 * asks anybody to paste a token into a chat — all three are things a desktop
 * assistant can be talked into offering and none of them are safe to normalise.
 *
 * The listener lives for the length of one sign-in and is closed the moment the
 * answer arrives or the wait runs out. A port left open is a permanent hole for
 * something that is used once every few months.
 */

/** How long the browser has before the sign-in is given up on. */
const WAIT_MS = 5 * 60 * 1000;

const base64url = (value: Buffer): string => value.toString('base64url');

/** A PKCE verifier and its `S256` challenge, per RFC 7636. */
export const makePkcePair = (): { verifier: string; challenge: string } => {
  const verifier = base64url(randomBytes(64));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
};

/** What the browser is shown once it has come back, so the tab is not a blank. */
const closingPage = (message: string): string =>
  `<!doctype html><meta charset="utf-8"><title>The Fool</title><body style="font:16px system-ui;padding:3rem;text-align:center">${message}</body>`;

type Waiter = { url: string; done: Promise<{ ok: true; code: string } | { ok: false; detail: string }> };

/**
 * Opens a port, and hands back where to send the browser and what to wait on.
 *
 * The port comes from {@link SPOTIFY_REDIRECT_PORTS} rather than from the
 * operating system, because Spotify matches the redirect URI exactly against
 * what the user registered — an address with a port nobody could predict is one
 * nobody could have registered. The list is tried in order so that a port
 * another application already holds costs a retry rather than the sign-in.
 *
 * Answers `null` when none of them could be bound, which the caller reports as
 * a reason rather than as a browser window that opens onto an error.
 */
const listenOnPort = (port: number, clientId: string, state: string, challenge: string): Promise<Waiter | null> =>
  new Promise((resolve) => {
    let settle: (value: { ok: true; code: string } | { ok: false; detail: string }) => void = () => undefined;
    const done = new Promise<{ ok: true; code: string } | { ok: false; detail: string }>((r) => (settle = r));

    let server: Server | null = null;
    let timer: NodeJS.Timeout | null = null;
    const finish = (value: { ok: true; code: string } | { ok: false; detail: string }): void => {
      if (timer) clearTimeout(timer);
      timer = null;
      server?.close();
      server = null;
      settle(value);
    };

    server = createServer((request, response) => {
      // Only the one path answers. Anything else on this port is not part of a
      // sign-in and is told so rather than being handed the page.
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        response.writeHead(404).end();
        return;
      }

      const answer = readAuthorizeCallback(url.searchParams, state);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      // Split rather than written as two ternaries, because a ternary does not
      // narrow this union. The project has no `strictNullChecks`, so testing
      // `answer.ok` for truthiness leaves both members in scope and `detail`
      // belongs to only one of them — the same reason `CallbackResult` carries
      // a `reason` literal at all.
      if (answer.ok === false) {
        response.end(closingPage('That sign-in could not be completed.'));
        finish({ ok: false, detail: answer.detail });
        return;
      }
      response.end(closingPage('Spotify is connected. You can close this tab.'));
      finish({ ok: true, code: answer.code });
    });

    // A port already held by something else is the ordinary case here, not a
    // fault: it resolves to nothing and the caller tries the next one.
    server.on('error', () => resolve(null));
    // 127.0.0.1 rather than 0.0.0.0: an authorization code arriving from
    // another machine is not a sign-in this user started.
    server.listen(port, '127.0.0.1', () => {
      const address = server?.address();
      if (address === null || typeof address !== 'object') {
        finish({ ok: false, detail: 'no port' });
        resolve(null);
        return;
      }

      const url = buildAuthorizeUrl({
        clientId,
        redirectUri: redirectUriFor(address.port),
        codeChallenge: challenge,
        state,
        scopes: SPOTIFY_SCOPES,
      });
      if (!url) {
        finish({ ok: false, detail: 'bad client id' });
        resolve(null);
        return;
      }

      timer = setTimeout(() => finish({ ok: false, detail: 'timed out' }), WAIT_MS);
      resolve({ url, done });
    });
  });

/**
 * The first of the registered ports that could actually be bound.
 *
 * Sequential on purpose: binding all three and keeping one would leave two
 * listeners open on a user's machine for a sign-in that only ever needed one.
 */
const listenForCallback = async (clientId: string, state: string, challenge: string): Promise<Waiter | null> => {
  for (const port of SPOTIFY_REDIRECT_PORTS) {
    const waiter = await listenOnPort(port, clientId, state, challenge);
    if (waiter) return waiter;
  }
  return null;
};

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number };

const postToken = async (body: URLSearchParams): Promise<TokenResponse | null> => {
  try {
    const response = await fetch(SPOTIFY_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!response.ok) return null;
    return (await response.json()) as TokenResponse;
  } catch {
    return null;
  }
};

/** Who is connected, so the settings page can say more than "connected". */
const readDisplayName = async (accessToken: string): Promise<string> => {
  try {
    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return '';
    const me = (await response.json()) as { display_name?: string };
    return typeof me.display_name === 'string' ? me.display_name : '';
  } catch {
    return '';
  }
};

export type ConnectOutcome = { ok: true; displayName: string } | { ok: false; reason: string };

/**
 * Runs one sign-in from start to finish.
 *
 * Everything it needs beyond the client id is generated here and never stored:
 * the verifier lives for the length of this call, and the state with it.
 */
export const connectSpotify = async (): Promise<ConnectOutcome> => {
  const stored = readConnection();
  const clientId = stored.clientId.trim();
  if (clientId.length === 0) return { ok: false, reason: 'no-client-id' };

  const { verifier, challenge } = makePkcePair();
  const state = randomBytes(16).toString('hex');
  const waiter = await listenForCallback(clientId, state, challenge);
  if (!waiter) return { ok: false, reason: 'no-port' };

  // Their browser, not a window of ours. An embedded one would be a place a
  // password is typed inside this application, which is the whole thing this
  // flow exists to avoid.
  await shell.openExternal(waiter.url);

  const answered = await waiter.done;
  if (answered.ok === false) return { ok: false, reason: answered.detail };

  const redirectUri = new URL(waiter.url).searchParams.get('redirect_uri') ?? '';
  const token = await postToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: answered.code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    })
  );
  if (!token?.access_token || !token.refresh_token) return { ok: false, reason: 'token-exchange-failed' };

  const tokens: SpotifyTokens = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: expiryFrom(Date.now(), token.expires_in ?? 3600),
  };
  const displayName = await readDisplayName(tokens.accessToken);
  writeConnection({ clientId, tokens, displayName });
  return { ok: true, displayName };
};

/**
 * A usable access token, refreshing it if the stored one has run out.
 *
 * `null` means there is no connection to use — never a stale token handed on in
 * hope. A request made with an expired token comes back 401, and the assistant
 * would report that as "I could not play it" when the truth is that it needs
 * signing in again.
 */
export const freshAccessToken = async (): Promise<string | null> => {
  const stored = readConnection();
  if (!stored.tokens) return null;
  if (tokenUsable(stored.tokens, Date.now())) return stored.tokens.accessToken;

  const token = await postToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.tokens.refreshToken,
      client_id: stored.clientId,
    })
  );
  if (!token?.access_token) return null;

  const tokens: SpotifyTokens = {
    accessToken: token.access_token,
    // Spotify usually returns the same refresh token and sometimes a new one.
    // Keeping the old one when none came back is the difference between a
    // connection that lasts and one that quietly expires in a month.
    refreshToken: token.refresh_token ?? stored.tokens.refreshToken,
    expiresAt: expiryFrom(Date.now(), token.expires_in ?? 3600),
  };
  writeConnection({ ...stored, tokens });
  return tokens.accessToken;
};
