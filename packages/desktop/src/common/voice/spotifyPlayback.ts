/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Playing something on Spotify without taking the screen.
 *
 * This is the answer to a problem that was written off as impossible. Asking
 * for a song opened it in the default browser, which steals focus, cannot be
 * paused or seeked from here, and puts a video in front of whatever the user
 * was doing. The only design that satisfies "play it, in the background, and
 * let me control it" was an app that owns the playback — and building a music
 * player was rightly not on the table.
 *
 * Spotify already is that app. It is running, it has a device list, and its API
 * takes "play this, on that device" — so the song starts where the user's music
 * already comes from, at the volume they left it, with their own controls.
 *
 * What lives here is the part with no network in it: choosing *where* to play,
 * and saying plainly when there is nowhere. Everything about tokens, requests
 * and the MCP server sits outside; this is the decision, and the decision is
 * the part that is easy to get quietly wrong.
 */

export type SpotifyDevice = {
  id: string;
  name: string;
  /** What Spotify calls it: `Computer`, `Smartphone`, `Speaker`, … */
  type: string;
  /** True for the one currently playing or last used. */
  isActive: boolean;
  /** Spotify refuses to start playback on a device it has marked restricted. */
  isRestricted: boolean;
};

export type PlaybackTarget =
  | { kind: 'device'; device: SpotifyDevice }
  /** Nothing is open. The user has to start Spotify somewhere first. */
  | { kind: 'no-device' }
  /** Devices exist but none will take a command. */
  | { kind: 'all-restricted' };

/**
 * Where to play, given everything Spotify says is available.
 *
 * The active device wins outright — it is where their music is already coming
 * from, and moving playback to a different speaker because it sorted first
 * would be a genuinely alarming thing for an assistant to do.
 *
 * With nothing active, a computer is preferred over a phone. Both are theirs,
 * but the phone might be in another room, and a song starting somewhere the
 * user cannot hear reads exactly like the failure this whole feature exists to
 * fix: told it is playing, and hearing nothing.
 */
export const choosePlaybackTarget = (devices: readonly SpotifyDevice[]): PlaybackTarget => {
  const usable = devices.filter((device) => !device.isRestricted);
  if (devices.length === 0) return { kind: 'no-device' };
  if (usable.length === 0) return { kind: 'all-restricted' };

  const active = usable.find((device) => device.isActive);
  if (active) return { kind: 'device', device: active };

  const rank = (device: SpotifyDevice): number => {
    const type = device.type.toLowerCase();
    if (type === 'computer') return 0;
    if (type === 'speaker') return 1;
    if (type === 'smartphone') return 2;
    return 3;
  };

  return { kind: 'device', device: usable.toSorted((a, b) => rank(a) - rank(b))[0] };
};

/**
 * A spotify: URI out of whatever the user or the model produced.
 *
 * Three spellings arrive in practice: the URI itself, a share link copied from
 * the app, and an open.spotify.com address from a browser. All three carry the
 * same id in the same place, and anything else is refused rather than guessed
 * at — a malformed URI is a 400 from Spotify, which surfaces to the user as the
 * assistant saying it played something and nothing happening.
 */
const KINDS = ['track', 'album', 'playlist', 'artist', 'show', 'episode'] as const;
export type SpotifyKind = (typeof KINDS)[number];

export const toSpotifyUri = (input: string): string | null => {
  const text = input.trim();
  if (text.length === 0) return null;

  const direct = /^spotify:(\w+):([A-Za-z0-9]{22})$/.exec(text);
  if (direct && (KINDS as readonly string[]).includes(direct[1])) return `spotify:${direct[1]}:${direct[2]}`;

  const link = /^https?:\/\/open\.spotify\.com\/(?:intl-\w+\/)?(\w+)\/([A-Za-z0-9]{22})/.exec(text);
  if (link && (KINDS as readonly string[]).includes(link[1])) return `spotify:${link[1]}:${link[2]}`;

  return null;
};

/**
 * What a play request becomes on the wire.
 *
 * A track goes in `uris`; anything with a running order — an album, a playlist,
 * an artist's page — goes in `context_uri`, and sending one as the other is
 * accepted by the API and then plays nothing.
 */
export const playBodyFor = (uri: string): { uris: string[] } | { context_uri: string } | null => {
  const normalised = toSpotifyUri(uri);
  if (!normalised) return null;

  const kind = normalised.split(':')[1] as SpotifyKind;
  return kind === 'track' || kind === 'episode' ? { uris: [normalised] } : { context_uri: normalised };
};
