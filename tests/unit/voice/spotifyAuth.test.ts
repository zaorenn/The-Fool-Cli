/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildAuthorizeUrl,
  expiryFrom,
  isSpotifyClientId,
  readAuthorizeCallback,
  redirectUriFor,
  SPOTIFY_REDIRECT_PORTS,
  SPOTIFY_SCOPES,
  spotifyRedirectUris,
  tokenUsable,
} from '@/common/voice/spotifyAuth';

const CLIENT_ID = '0123456789abcdef0123456789abcdef';

/**
 * Signing the user in without this application ever holding a password.
 *
 * The sign-in page is Spotify's own, opened in the user's own browser. Nothing
 * here renders a login form, and nothing anywhere in this app may grow one: the
 * assistant asks whether to connect, the user answers on Spotify's page, and
 * the code comes back to a port this process is holding.
 */
describe('buildAuthorizeUrl', () => {
  it('sends the browser to Spotify with PKCE and nothing else', () => {
    const url = buildAuthorizeUrl({
      clientId: CLIENT_ID,
      redirectUri: redirectUriFor(51234),
      codeChallenge: 'challenge-value',
      state: 'state-value',
    });

    const parsed = new URL(url ?? '');
    expect(parsed.origin + parsed.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(parsed.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(parsed.searchParams.get('state')).toBe('state-value');
    expect(parsed.searchParams.get('scope')).toBe(SPOTIFY_SCOPES.join(' '));
  });

  /**
   * A public client proves it started the exchange with a verifier, not with a
   * secret. A secret shipped inside a desktop application is not a secret, and
   * the URL must never carry one.
   */
  it('never carries a client secret', () => {
    const url =
      buildAuthorizeUrl({
        clientId: CLIENT_ID,
        redirectUri: redirectUriFor(51234),
        codeChallenge: 'challenge-value',
        state: 'state-value',
      }) ?? '';

    expect(url).not.toContain('client_secret');
    expect(url).not.toContain('secret');
  });

  /**
   * Answered as "there is no URL" rather than as a URL built from blanks: a
   * user told to check their browser, who finds a Spotify error page, has been
   * sent to debug our bug.
   */
  it('refuses to build a malformed sign-in', () => {
    const base = { redirectUri: redirectUriFor(1), codeChallenge: 'c', state: 's' };

    expect(buildAuthorizeUrl({ ...base, clientId: '' })).toBeNull();
    expect(buildAuthorizeUrl({ ...base, clientId: '   ' })).toBeNull();
    expect(buildAuthorizeUrl({ ...base, clientId: CLIENT_ID, codeChallenge: '' })).toBeNull();
    expect(buildAuthorizeUrl({ ...base, clientId: CLIENT_ID, state: '' })).toBeNull();
  });

  it('comes back to loopback rather than to a custom scheme', () => {
    // Any application on the machine can claim a scheme and receive the code.
    // A port bound by this process is held by this process.
    expect(redirectUriFor(51234)).toBe('http://127.0.0.1:51234/callback');
  });
});

/**
 * The ports are fixed, and that is a requirement rather than a preference.
 *
 * Spotify matches the redirect URI exactly against what the user registered in
 * their dashboard. An ephemeral port — which is what this originally used —
 * produces a different address on every attempt, so it can never have been
 * registered in advance and the sign-in cannot complete at all.
 */
describe('the addresses the user has to register', () => {
  it('are stable, so they can be registered in advance', () => {
    expect(SPOTIFY_REDIRECT_PORTS.length).toBeGreaterThan(1);
    expect(spotifyRedirectUris()).toEqual([
      'http://127.0.0.1:8888/callback',
      'http://127.0.0.1:8889/callback',
      'http://127.0.0.1:8890/callback',
    ]);
  });

  /**
   * Derived rather than written out twice. A disagreement between the list the
   * settings page shows and the port actually bound is an error page in
   * somebody else's browser, which is the hardest kind of bug to have reported.
   */
  it('are derived from the ports that are actually bound', () => {
    expect(spotifyRedirectUris()).toEqual(SPOTIFY_REDIRECT_PORTS.map(redirectUriFor));
  });

  it('are loopback and http, which is what a registered redirect must be', () => {
    for (const uri of spotifyRedirectUris()) {
      expect(uri.startsWith('http://127.0.0.1:'), uri).toBe(true);
      expect(uri.endsWith('/callback'), uri).toBe(true);
    }
  });
});

describe('readAuthorizeCallback', () => {
  const query = (values: Record<string, string>): URLSearchParams => new URLSearchParams(values);

  it('reads the code out of an answer that belongs to this sign-in', () => {
    const answer = readAuthorizeCallback(query({ code: 'the-code', state: 'abc' }), 'abc');

    expect(answer.ok).toBe(true);
    expect(answer.ok === true && answer.code).toBe('the-code');
  });

  /**
   * The state check is the whole reason this is a function. The loopback
   * listener accepts a request from anything on the machine that can reach the
   * port, so without it a page open in the browser could post its own code and
   * connect the assistant to an account the user does not own.
   */
  it('refuses an answer that did not belong to this request', () => {
    const answer = readAuthorizeCallback(query({ code: 'attacker-code', state: 'wrong' }), 'abc');

    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.reason).toBe('state');
  });

  it('refuses everything when there was no state to compare against', () => {
    const answer = readAuthorizeCallback(query({ code: 'the-code', state: '' }), '');

    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.reason).toBe('state');
  });

  it('reports a refusal as a refusal rather than as a fault', () => {
    const answer = readAuthorizeCallback(query({ error: 'access_denied', state: 'abc' }), 'abc');

    expect(answer.ok === false && answer.reason).toBe('denied');
  });

  it('reports an answer with no code in it', () => {
    const answer = readAuthorizeCallback(query({ state: 'abc' }), 'abc');

    expect(answer.ok === false && answer.reason).toBe('malformed');
  });
});

describe('tokenUsable', () => {
  const now = 1_000_000;

  it('accepts a token with time left on it', () => {
    expect(tokenUsable({ accessToken: 'a', refreshToken: 'r', expiresAt: now + 1000 }, now)).toBe(true);
  });

  it('refuses one that has run out, and one that is not there', () => {
    expect(tokenUsable({ accessToken: 'a', refreshToken: 'r', expiresAt: now - 1 }, now)).toBe(false);
    expect(tokenUsable({ accessToken: '', refreshToken: 'r', expiresAt: now + 1000 }, now)).toBe(false);
    expect(tokenUsable(null, now)).toBe(false);
  });

  /**
   * The minute taken off is deliberate. A token that expires during the round
   * trip is indistinguishable, from the user's side, from the assistant lying
   * about having played something — the call fails after the sentence was said.
   */
  it('retires a token a minute before it actually expires', () => {
    expect(expiryFrom(now, 3600)).toBe(now + 3540 * 1000);
    // And never answers with a time in the past for a very short-lived token.
    expect(expiryFrom(now, 30)).toBe(now);
  });
});

describe('isSpotifyClientId', () => {
  it('accepts the 32 hex characters Spotify issues', () => {
    expect(isSpotifyClientId(CLIENT_ID)).toBe(true);
    // Checked after trimming, because this value is pasted by hand and a
    // trailing space otherwise fails as an opaque error page in the browser.
    expect(isSpotifyClientId(` ${CLIENT_ID} `)).toBe(true);
  });

  it('refuses anything else', () => {
    for (const value of [
      '',
      'not-an-id',
      CLIENT_ID.slice(0, 31),
      `${CLIENT_ID}0`,
      'zzz3456789abcdef0123456789abcdef',
    ]) {
      expect(isSpotifyClientId(value), value).toBe(false);
    }
  });
});
