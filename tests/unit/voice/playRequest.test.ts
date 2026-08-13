/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { choosePlayRoute } from '@/common/voice/playRequest';

/**
 * Where "play that" is allowed to go.
 *
 * Written from a transcript. Asked for a favourite song, the assistant searched
 * YouTube, drove the pointer at the results, screenshotted a loading page,
 * clicked again, screenshotted again — and then said it was playing. Every one
 * of those steps is the wrong instrument for a request the operating system
 * answers in a single call, so the routing is decided here rather than by
 * whichever tool a model happens to notice, and none of the branches ends in a
 * pointer moving.
 */
describe('choosePlayRoute', () => {
  it('plays on the music service when one is connected', () => {
    const route = choosePlayRoute({ what: 'Bunny Girl', spotifyConnected: true });

    expect(route.kind).toBe('spotify');
    expect(route.kind === 'spotify' && route.query).toBe('Bunny Girl');
  });

  /**
   * The case that was being answered with a mouse. Nothing is connected, so the
   * honest fallback is the user's own browser — instantly, and as a search page
   * that certainly exists.
   */
  it('falls back to the browser when nothing is connected', () => {
    const route = choosePlayRoute({ what: 'Bunny Girl', spotifyConnected: false });

    expect(route.kind).toBe('browser');
    expect(route.kind === 'browser' && route.url).toContain('Bunny');
  });

  /**
   * An address built out of a title does not exist, and opening one is this
   * area's failure in a new shape: a page that 404s, reported as a song.
   * A resolved address is used; the absence of one becomes a search.
   */
  it('opens a real address when one has already been resolved', () => {
    const route = choosePlayRoute({
      what: 'Bunny Girl',
      spotifyConnected: false,
      address: 'https://www.youtube.com/watch?v=abcdefghijk',
    });

    expect(route).toEqual({ kind: 'browser', url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  });

  it('refuses an address that is not a web address', () => {
    const route = choosePlayRoute({ what: 'Bunny Girl', spotifyConnected: false, address: 'file:///etc/passwd' });

    // Not opened. It falls through to a search for the words instead, which is
    // the same rule `parseOpenUrls` applies and for the same reason.
    expect(route.kind).toBe('browser');
    expect(route.kind === 'browser' && route.url).not.toContain('passwd');
  });

  it('sends a Spotify link to the service when it is connected', () => {
    const route = choosePlayRoute({
      what: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
      spotifyConnected: true,
    });

    expect(route.kind === 'spotify' && route.uri).toBe('spotify:track:4cOdK2wGLETKBW3PvgPWqT');
  });

  /**
   * The same link with nothing connected still belongs to Spotify — as a page
   * in the browser, which is where an unconnected user can actually play it.
   */
  it('turns a Spotify link into a Spotify page when it is not connected', () => {
    const route = choosePlayRoute({
      what: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
      spotifyConnected: false,
    });

    expect(route).toEqual({ kind: 'browser', url: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT' });
  });

  it('does nothing when nothing was asked for', () => {
    expect(choosePlayRoute({ what: '   ', spotifyConnected: false }).kind).toBe('nothing');
    expect(choosePlayRoute({ what: '', spotifyConnected: true }).kind).toBe('nothing');
  });

  /**
   * The property that matters more than any single branch: there is no input
   * for which the answer is "drive the screen". Screen automation is what is
   * left for things with genuinely no other route, and playing is not one.
   */
  it('never routes anything to the screen', () => {
    const inputs = [
      { what: 'Bunny Girl', spotifyConnected: true },
      { what: 'Bunny Girl', spotifyConnected: false },
      { what: 'some album', spotifyConnected: false, address: 'https://example.com/a' },
      { what: '', spotifyConnected: false, address: 'https://example.com/a' },
    ];

    for (const input of inputs) {
      expect(['spotify', 'browser', 'nothing']).toContain(choosePlayRoute(input).kind);
    }
  });
});
