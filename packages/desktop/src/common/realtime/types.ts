/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One vocabulary for three speech-to-speech providers.
 *
 * OpenAI, Gemini and the local pipeline agree on almost nothing at the wire:
 * different frame names, different envelopes, different sample rates, different
 * ideas of whose job it is to notice the user started talking. The page that
 * draws a conversation should not know any of that, so each provider gets an
 * adapter that speaks its own dialect and hands back the events named here.
 */

/** A speech-to-speech backend reached over a socket, through an adapter. */
export type RealtimeProviderId = 'openai-realtime' | 'gemini-live' | 'local-s2s';

/**
 * Everything the conversation page can be pointed at, socket or not.
 *
 * `local-pipeline` is the odd one and is kept out of {@link RealtimeProviderId}
 * for that reason: there is no server to speak a dialect to, because the app
 * assembles the conversation itself out of the transcriber, an OpenAI-compatible
 * chat endpoint and an installed voice. It has a spec and appears in the picker
 * like the others; it has no adapter, and the type says so.
 */
export type VoiceConversationProviderId = RealtimeProviderId | 'local-pipeline';

export type VoiceConversationPhase = 'listening' | 'thinking' | 'speaking' | 'acting';

/**
 * Something that happened in the conversation, stated the same way whoever said it.
 *
 * `interrupted` is separate from a phase change on purpose: it means "throw away
 * the audio you have queued", which the phase alone cannot express — a provider
 * often keeps speaking in the same phase while the samples already buffered are
 * no longer wanted.
 */
export type NormalizedRealtimeEvent =
  | { kind: 'ready' }
  | { kind: 'user-transcript'; text: string; final: boolean }
  | { kind: 'assistant-transcript'; text: string; final: boolean }
  /**
   * A block of PCM16 to play.
   *
   * `sampleRate` is carried per block rather than fixed per provider because a
   * local voice renders at whatever rate its own model uses — 22.05 kHz for one
   * installed engine, 24 kHz for another — and playing one at the other's rate
   * is the difference between a voice and a chipmunk.
   */
  | { kind: 'audio'; pcm16Base64: string; sampleRate?: number }
  | { kind: 'phase'; phase: VoiceConversationPhase }
  | { kind: 'interrupted' }
  | { kind: 'tool-call'; callId: string; name: string; argumentsJson: string }
  | { kind: 'error'; message: string };

/** A function the model may call, described the way both providers understand. */
export type RealtimeToolSchema = {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: readonly string[];
  };
};

/**
 * Everything a session needs, before any provider has been chosen.
 *
 * `instructions` is the whole persona — already assembled, already carrying the
 * delivery guidance — because every provider takes it as one block of text and
 * none of them would agree on how to combine several.
 */
export type RealtimeSessionConfig = {
  model: string;
  voice: string;
  instructions: string;
  /** BCP-47-ish tag, or `auto` to let the model follow whoever is speaking. */
  language: string;
  tools: readonly RealtimeToolSchema[];
};

/**
 * What the main process hands back so the renderer can open a socket.
 *
 * A token rather than the API key wherever the provider can mint one: an
 * ephemeral secret that expires in a minute is a much smaller thing to have
 * sitting in a window than the key the user pays with.
 */
export type RealtimeCredential = {
  providerId: RealtimeProviderId;
  /** Empty for the local pipeline, which is not authenticated. */
  token: string;
  /** Where to connect. Already carries the model for providers that want it there. */
  endpoint: string;
  /** True when `token` expires shortly and a new session must ask again. */
  ephemeral: boolean;
};

/**
 * A provider's dialect, reduced to the handful of things a session does.
 *
 * Frames are returned as arrays throughout — several providers need two frames
 * where another needs one (Gemini answers a tool call and then has nothing more
 * to say; OpenAI has to be told to start speaking again), and a caller that has
 * to remember which is which would get it wrong for one of them.
 */
export type RealtimeAdapter = {
  id: RealtimeProviderId;
  /** The rate the microphone must be resampled to before frames are sent. */
  inputSampleRate: number;
  /** The rate the provider's audio arrives at, for playback scheduling. */
  outputSampleRate: number;
  /**
   * WebSocket subprotocols, for the providers that authenticate through them.
   *
   * Empty where the credential rides in the URL instead.
   */
  subprotocols: (credential: RealtimeCredential) => readonly string[];
  buildUrl: (credential: RealtimeCredential, config: RealtimeSessionConfig) => string;
  /** Sent the moment the socket opens: session configuration, persona, tools. */
  openingFrames: (config: RealtimeSessionConfig) => readonly object[];
  audioFrames: (pcm16Base64: string) => readonly object[];
  toolResultFrames: (callId: string, name: string, output: Record<string, unknown>) => readonly object[];
  /** Stops a reply that is being spoken. Empty where the provider handles it alone. */
  interruptFrames: () => readonly object[];
  /** Zero, one or several normalized events from one server frame. */
  parse: (value: unknown) => readonly NormalizedRealtimeEvent[];
};

export type RealtimeRecord = Record<string, unknown> & { type?: unknown };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * Rejects an endpoint that would send the user's speech somewhere unencrypted.
 *
 * Plain `ws:` is allowed only against the loopback interface, which is the local
 * pipeline talking to itself; anywhere else it would put a live microphone feed
 * on the network in the clear.
 */
export const validateRealtimeEndpoint = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (url.protocol === 'wss:') return true;
    return (
      url.protocol === 'ws:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1')
    );
  } catch {
    return false;
  }
};
