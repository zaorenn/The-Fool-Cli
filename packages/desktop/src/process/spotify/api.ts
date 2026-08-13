/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { choosePlaybackTarget, playBodyFor, toSpotifyUri, type SpotifyDevice } from '@/common/voice/spotifyPlayback';
import { freshAccessToken } from './connect';

/**
 * Playing something, and being able to say truthfully that it is playing.
 *
 * The decisions — which device, and what a URI turns into on the wire — are in
 * `common/voice/spotifyPlayback.ts`, tested without a network. What is here is
 * the three requests and, more importantly, the shape of the answer.
 *
 * That answer is the point of the file. Every path that does not end in Spotify
 * accepting a track answers `ok: false` with a reason, and nothing answers
 * `playing: true` unless a device has been named. The claim gate reads exactly
 * that field, so an optimistic `true` here would reopen the hole this work was
 * done to close — one layer further down, where nobody would think to look.
 */

const API = 'https://api.spotify.com/v1';

const request = async (
  token: string,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<{ status: number; json: unknown }> => {
  const response = await fetch(`${API}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  // 204 is what a successful play answers with, and it has no body at all.
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json };
};

type SearchResponse = { tracks?: { items?: { uri?: string; name?: string; artists?: { name?: string }[] }[] } };

/** The first track a query matches, or nothing. Never a guessed URI. */
const findTrack = async (token: string, query: string): Promise<{ uri: string; title: string } | null> => {
  const { status, json } = await request(token, `/search?type=track&limit=1&q=${encodeURIComponent(query)}`);
  if (status !== 200) return null;

  const first = (json as SearchResponse).tracks?.items?.[0];
  const uri = typeof first?.uri === 'string' ? toSpotifyUri(first.uri) : null;
  if (!uri) return null;

  const artist = first?.artists?.[0]?.name ?? '';
  const name = first?.name ?? '';
  return { uri, title: artist.length > 0 ? `${name} — ${artist}` : name };
};

type DevicesResponse = {
  devices?: { id?: string; name?: string; type?: string; is_active?: boolean; is_restricted?: boolean }[];
};

const readDevices = async (token: string): Promise<SpotifyDevice[]> => {
  const { status, json } = await request(token, '/me/player/devices');
  if (status !== 200) return [];

  return (
    (json as DevicesResponse).devices
      ?.filter((device): device is { id: string } & typeof device => typeof device.id === 'string')
      .map((device) => ({
        id: device.id,
        name: device.name ?? '',
        type: device.type ?? '',
        isActive: device.is_active === true,
        isRestricted: device.is_restricted === true,
      })) ?? []
  );
};

/** What a play attempt answers with. Never optimistic. */
export type SpotifyPlayResult =
  | { ok: true; track: string; device: string }
  /**
   * `reason` is ours rather than Spotify's, so the settings page and the spoken
   * assistant can say something a person understands: `not-connected`,
   * `no-device` (Spotify is not open anywhere), `all-restricted`, `not-found`,
   * `refused` (Spotify said no — most often a free account, which cannot be
   * told what to play), `failed`.
   */
  | { ok: false; reason: string };

/**
 * Plays one thing, on the device the user's music already comes from.
 *
 * Nothing is opened, nothing is focused and no window changes: this is the whole
 * reason the feature exists. A user who asked for a song while writing an email
 * should get the song and keep the email.
 */
export const playOnSpotify = async (input: { query: string; uri?: string | null }): Promise<SpotifyPlayResult> => {
  const token = await freshAccessToken();
  if (!token) return { ok: false, reason: 'not-connected' };

  const direct = input.uri ? toSpotifyUri(input.uri) : null;
  const found = direct ? { uri: direct, title: input.query.trim() } : await findTrack(token, input.query);
  if (!found) return { ok: false, reason: 'not-found' };

  const target = choosePlaybackTarget(await readDevices(token));
  // Said plainly rather than played into the void. "Nothing is playing and you
  // were told it was" is the exact failure this whole change is about, and
  // Spotify answers a play with no device by accepting it and doing nothing.
  if (target.kind !== 'device') return { ok: false, reason: target.kind };

  const body = playBodyFor(found.uri);
  if (!body) return { ok: false, reason: 'not-found' };

  const { status } = await request(token, `/me/player/play?device_id=${encodeURIComponent(target.device.id)}`, {
    method: 'PUT',
    body,
  });
  // 202 means Spotify took it but the device has not confirmed, which is not
  // the same as playing and is not reported as such.
  if (status === 204) return { ok: true, track: found.title, device: target.device.name };
  if (status === 403 || status === 401) return { ok: false, reason: 'refused' };
  return { ok: false, reason: 'failed' };
};
