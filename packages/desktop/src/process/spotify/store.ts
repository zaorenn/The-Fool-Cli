/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { SpotifyTokens } from '@/common/voice/spotifyAuth';

/**
 * Where the Spotify connection is kept, and why it is not kept with the rest.
 *
 * A refresh token is a standing permission to control somebody's music account.
 * The application's ordinary preferences travel: they are served over the local
 * HTTP bridge, they reach every window including the WebUI host, and they are
 * readable by the renderer — which is the process that runs model output. None
 * of that should be true of this.
 *
 * So it lives in the main process alone, in a file of its own, and nothing ever
 * hands it across the bridge. The renderer can ask *whether* there is a
 * connection and ask for a song to be played; it cannot read the token that
 * makes either possible.
 *
 * It is a file on the user's disk, not a vault, and that is worth saying plainly
 * rather than implying otherwise: anything already able to read the user's home
 * directory can read it. What this buys is that it is not exposed by the app
 * itself to code that had no business seeing it.
 */

export type SpotifyConnection = {
  /**
   * The user's own application id, from their Spotify developer dashboard.
   *
   * Not a secret — PKCE is designed around the id being public — but it is
   * theirs, and there is no honest value to compile in. See `spotifyAuth.ts`.
   */
  clientId: string;
  tokens: SpotifyTokens | null;
  /** What Spotify calls the connected account, for the settings page to show. */
  displayName: string;
};

const EMPTY: SpotifyConnection = { clientId: '', tokens: null, displayName: '' };

/**
 * The file, or an empty string when there is no Electron app to ask.
 *
 * Guarded rather than assumed, following `browserControlServer`: `app.getPath`
 * throws outside a running main process, and a module that dies on import takes
 * everything importing it down with it.
 */
export const connectionFilePath = (): string => {
  try {
    return path.join(app.getPath('userData'), 'fool', 'spotify.json');
  } catch {
    return '';
  }
};

let cached: SpotifyConnection | null = null;

/** Everything known about the connection, repaired on read. */
export const readConnection = (): SpotifyConnection => {
  if (cached) return cached;

  const file = connectionFilePath();
  if (file.length === 0) return EMPTY;

  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (raw === null || typeof raw !== 'object') return EMPTY;

    const record = raw as Partial<SpotifyConnection>;
    const tokens = record.tokens;
    const usable =
      tokens !== null &&
      typeof tokens === 'object' &&
      typeof tokens.accessToken === 'string' &&
      typeof tokens.refreshToken === 'string' &&
      typeof tokens.expiresAt === 'number';

    cached = {
      clientId: typeof record.clientId === 'string' ? record.clientId : '',
      // A half-written token is no token. Kept as `null` rather than as an
      // object with blanks in it, so every caller has one thing to check.
      tokens: usable ? { ...(tokens as SpotifyTokens) } : null,
      displayName: typeof record.displayName === 'string' ? record.displayName : '',
    };
    return cached;
  } catch {
    // A missing file is the ordinary case on a fresh install, and an unreadable
    // one is a file somebody edited. Both are "not connected".
    return EMPTY;
  }
};

/** Replaces what is stored, and keeps the in-memory copy in step. */
export const writeConnection = (next: SpotifyConnection): void => {
  cached = next;
  const file = connectionFilePath();
  if (file.length === 0) return;

  mkdirSync(path.dirname(file), { recursive: true });
  // 0600: the token is a permission to act as this person, and there is no
  // reason for another account on the machine to be able to read it.
  writeFileSync(file, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
};

/**
 * Forgets the connection entirely.
 *
 * The file is removed rather than blanked. "Disconnect" should not leave a
 * readable record of which account was connected, and a blank object on disk is
 * a smaller promise than the user thinks they are being given.
 */
export const clearConnection = (): void => {
  cached = EMPTY;
  const file = connectionFilePath();
  if (file.length === 0) return;
  try {
    rmSync(file, { force: true });
  } catch {
    // Nothing useful to do: the in-memory copy is already empty, so the app is
    // disconnected either way.
  }
};

/** Drops the cache, so the next read comes off disk. For tests and for reloads. */
export const forgetCachedConnection = (): void => {
  cached = null;
};
