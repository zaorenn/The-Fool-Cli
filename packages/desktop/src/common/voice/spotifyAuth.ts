/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Signing the user in to Spotify, without ever holding their password.
 *
 * The shape is Authorization Code with PKCE, and every part of that choice is a
 * refusal of something easier:
 *
 * - **No client secret.** The implicit alternative — the "client credentials"
 *   or "authorization code with secret" flows — needs one, and a secret shipped
 *   inside a desktop application is not a secret. PKCE exists exactly so a
 *   public client can prove it started the exchange without holding one.
 * - **No password, ever, anywhere near this app.** The sign-in page is Spotify's
 *   own, opened in the user's own browser, where their password manager works
 *   and where the address bar tells them who is asking. The application never
 *   sees a credential and must never offer a field for one.
 * - **A client id the user supplies.** There is no client id that could be
 *   compiled in honestly: the app is not registered with Spotify, and one
 *   registered by whoever built a fork would put every user's playback under
 *   somebody else's rate limit and somebody else's terms. So it is a setting,
 *   and the documentation says how to get one.
 *
 * What lives here is the part with no network and no process in it: the URL the
 * browser is sent to, what comes back on the redirect, and whether a token is
 * still good. That is the half worth testing, and the half that is easy to get
 * quietly wrong.
 */

/**
 * What the assistant is asking to be allowed to do.
 *
 * Read and control playback, and read the library enough to find a song by
 * name. Deliberately short of anything that *changes* the user's library:
 * nothing here can follow an artist, edit a playlist or delete a save, because
 * nothing the assistant is being built for needs to.
 */
export const SPOTIFY_SCOPES: readonly string[] = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
];

/** Spotify's own authorize page. Nothing else is ever opened for a sign-in. */
const AUTHORIZE = 'https://accounts.spotify.com/authorize';

/** Spotify's token endpoint, named here so the two callers cannot disagree. */
export const SPOTIFY_TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';

/**
 * The address Spotify sends the browser back to when the user has answered.
 *
 * Loopback, always. A custom protocol would work too and is worse: registering
 * one is a machine-wide change, and any application on the computer can claim
 * the same scheme and receive the code instead. A port bound by this process is
 * held by this process.
 */
export const redirectUriFor = (port: number): string => `http://127.0.0.1:${port}/callback`;

/**
 * The ports the sign-in will listen on, tried in this order.
 *
 * Fixed rather than chosen by the operating system, and the reason is the whole
 * usability of this feature. Spotify matches a redirect URI **exactly**,
 * including the port, against the list registered in the user's dashboard — so
 * an ephemeral port cannot work at all: the address would be different on every
 * attempt and could never have been registered in advance. Asking somebody to
 * re-register a port each time they sign in is not a flow anybody completes.
 *
 * Three of them rather than one because a single fixed port is a port something
 * else on the machine may already hold, and the failure that produces is a
 * sign-in that silently never completes. Every one of these is registered once,
 * by pasting three lines, and then never thought about again.
 */
export const SPOTIFY_REDIRECT_PORTS: readonly number[] = [8888, 8889, 8890];

/**
 * Every address the user has to register, which is what the settings page and
 * the documentation show them.
 *
 * Derived from the ports rather than written out beside them, so the two cannot
 * drift into disagreeing — and a disagreement here is an error page in somebody
 * else's browser, which is the hardest kind of bug for them to report.
 */
export const spotifyRedirectUris = (): readonly string[] => SPOTIFY_REDIRECT_PORTS.map(redirectUriFor);

export type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  /** The PKCE challenge — `S256` of the verifier, base64url, never the verifier. */
  codeChallenge: string;
  /** Random, and checked on the way back. This is the CSRF defence. */
  state: string;
  scopes?: readonly string[];
};

/**
 * The page to open in the user's browser, or nothing when it would be malformed.
 *
 * `null` rather than a URL built from blanks: an authorize call missing its
 * client id is answered by Spotify with an error page, and a user who was told
 * "check your browser" and finds one has been sent to debug our bug.
 */
export const buildAuthorizeUrl = (request: AuthorizeRequest): string | null => {
  const clientId = request.clientId.trim();
  if (clientId.length === 0 || request.codeChallenge.length === 0 || request.state.length === 0) return null;

  const query = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: request.redirectUri,
    code_challenge_method: 'S256',
    code_challenge: request.codeChallenge,
    state: request.state,
    scope: (request.scopes ?? SPOTIFY_SCOPES).join(' '),
  });
  return `${AUTHORIZE}?${query.toString()}`;
};

/** What came back on the redirect, once it has been read properly. */
export type CallbackResult =
  | { ok: true; code: string }
  /**
   * `reason` is one of ours, not Spotify's wording: `denied` when the user said
   * no, `state` when the answer did not belong to the request we started, and
   * `malformed` for anything else. Discriminated by the literal because this
   * project has no `strictNullChecks`, so a boolean would not narrow.
   */
  | { ok: false; reason: 'denied' | 'state' | 'malformed'; detail: string };

/**
 * Reads the redirect, refusing anything that is not an answer to *our* request.
 *
 * The state check is the whole reason this is a function rather than two lines
 * at the call site. The loopback listener accepts a request from anything on the
 * machine that can reach the port, so without it a page open in the browser
 * could post its own code and connect the assistant to an account the user does
 * not own.
 */
export const readAuthorizeCallback = (query: URLSearchParams, expectedState: string): CallbackResult => {
  const state = query.get('state') ?? '';
  if (expectedState.length === 0 || state !== expectedState) {
    return { ok: false, reason: 'state', detail: 'The answer did not belong to this sign-in.' };
  }

  const error = query.get('error');
  if (error) return { ok: false, reason: 'denied', detail: error };

  const code = query.get('code') ?? '';
  if (code.length === 0) return { ok: false, reason: 'malformed', detail: 'No code came back.' };

  return { ok: true, code };
};

/** A token and when it stops working, as it is kept between runs. */
export type SpotifyTokens = {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. Absolute rather than a duration, because it is stored. */
  expiresAt: number;
};

/**
 * When a token bought now stops being usable.
 *
 * A minute is taken off deliberately. A token that expires during the round trip
 * is indistinguishable, from the user's side, from the assistant lying about
 * having played something — the call fails after the sentence was said.
 */
export const expiryFrom = (now: number, expiresInSeconds: number): number =>
  now + Math.max(0, expiresInSeconds - 60) * 1000;

/** Whether this token still has time on it. */
export const tokenUsable = (tokens: SpotifyTokens | null, now: number): boolean =>
  tokens !== null && tokens.accessToken.length > 0 && tokens.expiresAt > now;

/**
 * A client id as it can be trusted.
 *
 * Spotify's are 32 lowercase hex characters. Checked because the value is typed
 * by hand into a settings field, and a pasted line with a space on the end
 * otherwise fails as an opaque error page in the browser rather than as a
 * message next to the field.
 */
export const isSpotifyClientId = (value: string): boolean => /^[0-9a-f]{32}$/i.test(value.trim());
