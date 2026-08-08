/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { choosePlaybackTarget, playBodyFor, toSpotifyUri, type SpotifyDevice } from '@/common/voice/spotifyPlayback';

const device = (over: Partial<SpotifyDevice> = {}): SpotifyDevice => ({
  id: 'd1',
  name: 'Desktop',
  type: 'Computer',
  isActive: false,
  isRestricted: false,
  ...over,
});

describe('choosePlaybackTarget', () => {
  it('plays where the music is already coming from', () => {
    // Moving playback to another speaker because it sorted first would be a
    // genuinely alarming thing for an assistant to do.
    const phone = device({ id: 'phone', type: 'Smartphone', isActive: true });
    const target = choosePlaybackTarget([device({ id: 'pc' }), phone]);

    expect(target).toEqual({ kind: 'device', device: phone });
  });

  it('prefers the computer when nothing is active', () => {
    // The phone might be in another room, and a song starting where they
    // cannot hear it is the very failure this feature exists to fix.
    const target = choosePlaybackTarget([device({ id: 'phone', type: 'Smartphone' }), device({ id: 'pc' })]);

    expect(target).toEqual({ kind: 'device', device: device({ id: 'pc' }) });
  });

  it('says plainly when Spotify is not open anywhere', () => {
    expect(choosePlaybackTarget([])).toEqual({ kind: 'no-device' });
  });

  it('distinguishes "nowhere" from "nowhere that will listen"', () => {
    // Different sentences to the user: one means open Spotify, the other means
    // the device you have open will not take commands.
    expect(choosePlaybackTarget([device({ isRestricted: true })])).toEqual({ kind: 'all-restricted' });
  });

  it('never picks a restricted device even when it is the active one', () => {
    const target = choosePlaybackTarget([
      device({ id: 'locked', isActive: true, isRestricted: true }),
      device({ id: 'pc' }),
    ]);

    expect(target).toEqual({ kind: 'device', device: device({ id: 'pc' }) });
  });
});

describe('toSpotifyUri', () => {
  it('takes the three spellings that actually arrive', () => {
    expect(toSpotifyUri('spotify:track:4cOdK2wGLETKBW3PvgPWqT')).toBe('spotify:track:4cOdK2wGLETKBW3PvgPWqT');
    expect(toSpotifyUri('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc')).toBe(
      'spotify:track:4cOdK2wGLETKBW3PvgPWqT'
    );
    expect(toSpotifyUri('https://open.spotify.com/intl-tr/album/4cOdK2wGLETKBW3PvgPWqT')).toBe(
      'spotify:album:4cOdK2wGLETKBW3PvgPWqT'
    );
  });

  it('refuses anything else rather than guessing', () => {
    // A malformed URI is a 400 from Spotify, which reaches the user as the
    // assistant saying it played something while nothing happened.
    expect(toSpotifyUri('Bunny Girl')).toBeNull();
    expect(toSpotifyUri('spotify:track:tooshort')).toBeNull();
    expect(toSpotifyUri('spotify:nonsense:4cOdK2wGLETKBW3PvgPWqT')).toBeNull();
    expect(toSpotifyUri('')).toBeNull();
  });
});

describe('playBodyFor', () => {
  it('sends a track as a list and a playlist as a context', () => {
    // Sending one as the other is accepted by the API and then plays nothing.
    expect(playBodyFor('spotify:track:4cOdK2wGLETKBW3PvgPWqT')).toEqual({
      uris: ['spotify:track:4cOdK2wGLETKBW3PvgPWqT'],
    });
    expect(playBodyFor('spotify:playlist:4cOdK2wGLETKBW3PvgPWqT')).toEqual({
      context_uri: 'spotify:playlist:4cOdK2wGLETKBW3PvgPWqT',
    });
  });

  it('answers with nothing for something it cannot play', () => {
    expect(playBodyFor('not a uri')).toBeNull();
  });
});
