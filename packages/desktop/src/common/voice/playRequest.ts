/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where "play that" goes, when nobody wants the mouse taken away.
 *
 * Watched in the app, asked for a favourite song: it searched YouTube, then
 * drove the pointer at the results, took a screenshot of the loading page,
 * clicked again, took another — the user's cursor and screen commandeered for
 * something the operating system does with a single call. Four tools and two
 * minutes later nothing was playing and the reply said it was.
 *
 * The screen is the wrong instrument for this and always was. Handing an address
 * to the default browser needs no pointer; playing on a music service the user
 * is already signed into needs no browser at all. Screen automation is what is
 * left for the things that genuinely have no other route, and reaching for it
 * first is how an assistant becomes something you have to sit and watch.
 *
 * So the route is decided here, in one pure function, rather than by whichever
 * tool a model happens to notice. Two of them, in preference order, and no third:
 *
 * 1. **A music service the user connected.** It plays in the background, on the
 *    device their music already comes from, and it can say so.
 * 2. **Their own default browser.** Instant, and honest about being a page that
 *    opened rather than a sound that started.
 */

import { buildSiteSearch } from '@/common/realtime/siteSearch';
import { toSpotifyUri } from './spotifyPlayback';

/** What one "play this" turns into. */
export type PlayRoute =
  /** Straight to the connected service, in the background. */
  | { kind: 'spotify'; query: string; uri: string | null }
  /** A real address, opened in the user's own default browser. */
  | { kind: 'browser'; url: string }
  /** Nothing was asked for, so nothing is opened. */
  | { kind: 'nothing' };

export type PlayRequest = {
  /** What to play, in the user's own words. */
  what: string;
  /** Whether a music service is connected and allowed to start playback. */
  spotifyConnected: boolean;
  /**
   * A real address for the thing, when one has already been resolved.
   *
   * Never a guess assembled from a title: an address built out of a name does
   * not exist, and opening it is the failure this whole area keeps producing in
   * a new shape. Absent means fall back to a search, which does exist.
   */
  address?: string;
};

/** Only the web. The same rule `parseOpenUrls` applies, for the same reason. */
const WEB_URL = /^https?:\/\/\S+$/i;

/**
 * The route for one request.
 *
 * Deliberately total and deliberately dull: every branch ends in something that
 * happens in the background, and none of them ends in a pointer moving.
 */
export const choosePlayRoute = (request: PlayRequest): PlayRoute => {
  const what = request.what.trim();
  const address = request.address?.trim() ?? '';
  if (what.length === 0 && address.length === 0) return { kind: 'nothing' };

  // A Spotify link is unambiguous about where it wants to be played, whether it
  // came from the user, from a search or from the model's own memory.
  const uri = toSpotifyUri(what) ?? toSpotifyUri(address);
  if (request.spotifyConnected) return { kind: 'spotify', query: what, uri };

  // Not connected. A real address if one was resolved, and otherwise a search —
  // which is a page that certainly exists, unlike a watch URL built from a title.
  if (uri) return { kind: 'browser', url: `https://open.spotify.com/${uri.split(':')[1]}/${uri.split(':')[2]}` };
  if (WEB_URL.test(address)) return { kind: 'browser', url: address };

  const search = buildSiteSearch('youtube', what);
  return search ? { kind: 'browser', url: search.url } : { kind: 'nothing' };
};

/**
 * What the tool answers with, in the one shape both callers read.
 *
 * `playing` is the field the claim gate reads, and it is the reason this type is
 * written down rather than assembled inline at each return: it must be `true`
 * only where a player has said so. A page that opened answers `false` beside the
 * address, which is the whole truth about what happened and the sentence the
 * assistant is then allowed to say.
 */
export type PlayOutcome =
  | { ok: true; playing: true; track: string; device: string }
  | {
      ok: true;
      playing: false;
      opened: true;
      url: string;
      reason?: string;
      /**
       * Whether it is worth asking about connecting a music service.
       *
       * A hint to ask, never an instruction to connect. Nothing may open a
       * sign-in off the back of this: the user is asked a plain question first,
       * says yes, and only then does their own browser open on the service's
       * own page. See the `app_connect` handler, which refuses without it.
       */
      offerSpotify?: boolean;
    }
  | { ok: false; error: string };
