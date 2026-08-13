/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ISpotifyStatus } from '@/common/adapter/ipcBridge';
import { isSpotifyClientId, tokenUsable } from '@/common/voice/spotifyAuth';
import { playOnSpotify } from './api';
import { connectSpotify } from './connect';
import { clearConnection, readConnection, writeConnection } from './store';

/**
 * The four things the rest of the application may ask about Spotify.
 *
 * What is *not* here is the point of the file: there is no channel that hands a
 * token to the renderer, and no channel that takes a credential from it. The
 * renderer can learn that an account is connected and can ask for a song; it
 * cannot read the token, and there is no way for it to send one either — which
 * also means no model output can ever produce one.
 */

const statusOf = (): ISpotifyStatus => {
  const stored = readConnection();
  return {
    hasClientId: stored.clientId.trim().length > 0,
    clientId: stored.clientId,
    // A refresh token is a connection even when the access token has expired:
    // the next call renews it. Saying "not connected" for that would send the
    // user back through a sign-in they do not need.
    connected:
      stored.tokens !== null && (tokenUsable(stored.tokens, Date.now()) || stored.tokens.refreshToken.length > 0),
    displayName: stored.displayName,
  };
};

export const initSpotifyBridge = (): void => {
  ipcBridge.spotify.status.provider(() => Promise.resolve({ success: true, data: statusOf() }));

  ipcBridge.spotify.setClientId.provider(({ clientId }) => {
    const wanted = clientId.trim();
    // An empty value clears it, which is how somebody removes an id they pasted
    // wrongly. Anything else has to look like one, so a mistyped value fails
    // here — beside the field — rather than as an error page in their browser.
    if (wanted.length > 0 && !isSpotifyClientId(wanted)) {
      return Promise.resolve({ success: false, msg: 'invalid-client-id' });
    }

    const stored = readConnection();
    // Changing the id invalidates the tokens: they were issued to the old
    // application and would fail on the next call with an error nobody could
    // read. Dropped here rather than left to rot.
    const changed = wanted !== stored.clientId;
    writeConnection({
      clientId: wanted,
      tokens: changed ? null : stored.tokens,
      displayName: changed ? '' : stored.displayName,
    });
    return Promise.resolve({ success: true, data: statusOf() });
  });

  ipcBridge.spotify.connect.provider(async () => {
    const outcome = await connectSpotify();
    if (outcome.ok === false) return { success: false, msg: outcome.reason };
    return { success: true, data: statusOf() };
  });

  ipcBridge.spotify.disconnect.provider(() => {
    clearConnection();
    return Promise.resolve({ success: true, data: statusOf() });
  });

  ipcBridge.spotify.play.provider(async ({ query, uri }) => {
    const result = await playOnSpotify({ query, uri });
    // Handed back whole, failure included. The caller has to be able to tell
    // "playing on the kitchen speaker" from "Spotify is not open anywhere",
    // because the second one is a sentence the user needs to hear.
    return { success: true, data: result };
  });
};
