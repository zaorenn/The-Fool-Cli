/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider } from '@/common/config/storage';
import { REALTIME_PROVIDER_SPECS, type RealtimeProviderId } from '@/common/realtime';

/**
 * Finding the account that pays for a spoken conversation.
 *
 * The user has already told this app about their OpenAI or Gemini key — it is
 * how every other model in here is reached. Asking for it a second time, in a
 * voice-shaped box, would give them two places for the same secret to be wrong
 * and no indication which one a failure came from. So the provider list is the
 * one source, and this picks the entry that can open a realtime socket.
 */

export type RealtimeProviderChoice = {
  /** The websocket origin, derived from the provider's HTTP base URL. */
  socketUrl: string;
  /** The HTTP base URL, kept so a client secret can be minted against it. */
  baseUrl: string;
  apiKey: string;
  providerName: string;
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

/**
 * `https://host/v1` becomes `wss://host/v1/realtime`.
 *
 * Derived rather than hard-coded so a proxy the user already routes their chat
 * traffic through is reached the same way. Plain `http` is upgraded to `ws` only
 * for loopback; anywhere else an unencrypted socket would put a live microphone
 * on the network, so it is refused by returning nothing.
 */
export const toRealtimeSocketUrl = (baseUrl: string): string | null => {
  try {
    const url = new URL(trimTrailingSlash(baseUrl));
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    else if (url.protocol === 'http:' && loopback) url.protocol = 'ws:';
    else return null;
    url.pathname = `${trimTrailingSlash(url.pathname)}/realtime`;
    return url.toString();
  } catch {
    return null;
  }
};

/**
 * The first enabled provider whose platform can carry this kind of session.
 *
 * Order is the user's own: the provider list is presented in the order they
 * arranged it, and the first workable entry is the one they would have picked.
 */
export const selectRealtimeProvider = (
  providers: readonly IProvider[],
  providerId: RealtimeProviderId
): RealtimeProviderChoice | null => {
  const spec = REALTIME_PROVIDER_SPECS[providerId];
  if (!spec.requiresCredential) return null;

  const platforms = new Set(spec.platforms);

  for (const provider of providers) {
    if (provider.enabled === false) continue;
    if (!platforms.has(provider.platform)) continue;
    const apiKey = (provider.api_key ?? '').trim();
    if (apiKey.length === 0) continue;

    const baseUrl = trimTrailingSlash(provider.base_url ?? '');
    // Gemini's socket is a fixed address that has nothing to do with the HTTP
    // base URL, so an unusable base URL must not disqualify the key.
    if (providerId === 'gemini-live') {
      return { socketUrl: '', baseUrl, apiKey, providerName: provider.name };
    }

    const socketUrl = toRealtimeSocketUrl(baseUrl);
    if (!socketUrl) continue;
    return { socketUrl, baseUrl, apiKey, providerName: provider.name };
  }

  return null;
};
