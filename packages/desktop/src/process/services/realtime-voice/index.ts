/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { httpRequest } from '@/common/adapter/httpBridge';
import type { IProvider } from '@/common/config/storage';
import { LOCAL_S2S_ENDPOINT, type RealtimeProviderId } from '@/common/realtime';
import type { VoiceRealtimeSessionRequest, VoiceRealtimeSessionResponse } from '@/common/types/foolVoice';
import { speechToSpeechRuntime } from '../speech-to-speech';
import { selectRealtimeProvider } from './selectRealtimeProvider';

export { selectRealtimeProvider, toRealtimeSocketUrl } from './selectRealtimeProvider';

/**
 * Handing the renderer just enough to open a conversation, and no more.
 *
 * The socket itself is opened in the window rather than here on purpose: audio
 * runs both ways continuously, and putting a process boundary in the middle of
 * it adds a copy, a serialisation and a scheduling hop to every frame in each
 * direction — which is exactly the latency a spoken conversation is made of.
 *
 * What stays in this process is the secret. Where the provider can mint a
 * short-lived token, that is what the window gets; the account key is only ever
 * handed over when there is no such thing, and it never leaves this machine
 * either way.
 */

/** How long a minted client secret should stay valid. */
const CLIENT_SECRET_SECONDS = 600;
const MINT_TIMEOUT_MS = 8000;

const readProviders = async (): Promise<IProvider[]> => {
  try {
    return (await httpRequest<IProvider[]>('GET', '/api/providers')) || [];
  } catch {
    return [];
  }
};

/**
 * Trades the account key for one that expires.
 *
 * Best effort by design: this endpoint is OpenAI's own, and the many gateways
 * that speak the rest of the Realtime API do not implement it. A failure here is
 * not a failed session — it means the account key is used directly, which is
 * what every one of those gateways expects anyway.
 */
const mintClientSecret = async (baseUrl: string, apiKey: string, model: string): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MINT_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/realtime/client_secrets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: CLIENT_SECRET_SECONDS },
        session: { type: 'realtime', model },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return null;
    const value = (body as { value?: unknown }).value;
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Everything a window needs to connect, or a reason it cannot.
 *
 * The reasons are codes rather than sentences because the window is the side
 * that speaks the user's language; "no provider configured" has to become a
 * translated line with a button that opens the provider settings, and it cannot
 * do that with an English string.
 */
export const resolveRealtimeSession = async (
  request: VoiceRealtimeSessionRequest
): Promise<VoiceRealtimeSessionResponse> => {
  const providerId = request.providerId as RealtimeProviderId;

  if (providerId === 'local-s2s') {
    const runtime = await speechToSpeechRuntime.ensureReady();
    return {
      providerId,
      token: '',
      endpoint: runtime.endpoint || LOCAL_S2S_ENDPOINT,
      ephemeral: false,
      providerName: 'Local',
    };
  }

  const choice = selectRealtimeProvider(await readProviders(), providerId);
  if (!choice) throw new Error('REALTIME_NO_PROVIDER');

  if (providerId === 'gemini-live') {
    return {
      providerId,
      token: choice.apiKey,
      endpoint: '',
      ephemeral: false,
      providerName: choice.providerName,
    };
  }

  const secret = await mintClientSecret(choice.baseUrl, choice.apiKey, request.model);
  return {
    providerId,
    token: secret ?? choice.apiKey,
    endpoint: choice.socketUrl,
    ephemeral: secret !== null,
    providerName: choice.providerName,
  };
};
