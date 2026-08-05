/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getRealtimeAdapter,
  validateRealtimeEndpoint,
  type NormalizedRealtimeEvent,
  type RealtimeAdapter,
  type RealtimeCredential,
  type RealtimeSessionConfig,
} from '@/common/realtime';

/**
 * One socket, whichever provider is on the other end of it.
 *
 * The dialect lives in the adapter; what lives here is the part every provider
 * shares — opening the connection, not sending audio into it before it is ready,
 * and turning a dropped connection into something the page can say out loud.
 */

/** The parts of a `WebSocket` this uses, so a test can supply its own. */
export type RealtimeSocket = {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event?: { code?: number; reason?: string }) => void) | null;
  send: (data: string) => void;
  close: () => void;
};

export type RealtimeVoiceClientOptions = {
  credential: RealtimeCredential;
  config: RealtimeSessionConfig;
  createSocket?: (url: string, protocols: readonly string[]) => RealtimeSocket;
  onEvent: (event: NormalizedRealtimeEvent) => void;
};

const OPEN = 1;

/**
 * How long to wait for the provider to acknowledge the session.
 *
 * Not the connection — the socket is open well before this. This is the gap
 * between "connected" and "configured", and audio sent inside it is discarded by
 * one provider and rejected by another. Ten seconds is far longer than any of
 * them take and short enough that a session which will never start says so.
 */
const READY_TIMEOUT_MS = 10000;

export class RealtimeVoiceClient {
  private readonly adapter: RealtimeAdapter;
  private readonly credential: RealtimeCredential;
  private readonly config: RealtimeSessionConfig;
  private readonly createSocket: (url: string, protocols: readonly string[]) => RealtimeSocket;
  private readonly onEvent: (event: NormalizedRealtimeEvent) => void;
  private socket: RealtimeSocket | null = null;
  private ready = false;
  /**
   * Abandons a connection still being opened.
   *
   * Without this, stopping while it connects leaves the caller waiting on the
   * ready timeout — ten seconds of a page that says "connecting" after the user
   * pressed stop.
   */
  private abandon: ((error: Error) => void) | null = null;
  /** Set once the caller has been told; a later close is news, not a failure. */
  private settled = false;

  constructor(options: RealtimeVoiceClientOptions) {
    this.adapter = getRealtimeAdapter(options.credential.providerId);
    this.credential = options.credential;
    this.config = options.config;
    this.createSocket =
      options.createSocket ??
      ((url, protocols) => new WebSocket(url, protocols as string[]) as unknown as RealtimeSocket);
    this.onEvent = options.onEvent;
  }

  get inputSampleRate(): number {
    return this.adapter.inputSampleRate;
  }

  get outputSampleRate(): number {
    return this.adapter.outputSampleRate;
  }

  /**
   * Opens the socket and waits for the session to be acknowledged.
   *
   * Resolving on `open` would be earlier and wrong: Gemini discards realtime
   * input that arrives before `setupComplete`, and OpenAI applies a persona sent
   * before `session.created` to nothing. The first thing the caller does with
   * this promise is switch the microphone on, so it has to mean *ready*.
   */
  connect(): Promise<void> {
    const url = this.adapter.buildUrl(this.credential, this.config);
    if (!validateRealtimeEndpoint(url)) return Promise.reject(new Error('REALTIME_UNSAFE_ENDPOINT'));

    return new Promise((resolve, reject) => {
      const finish = (error?: Error): void => {
        if (this.settled) return;
        this.settled = true;
        this.abandon = null;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };

      const timer = setTimeout(() => {
        // The socket is left open: several providers acknowledge late under
        // load, and tearing it down here would turn a slow start into a failure.
        finish(new Error('REALTIME_SESSION_TIMEOUT'));
      }, READY_TIMEOUT_MS);

      this.abandon = finish;

      const socket = this.createSocket(url, this.adapter.subprotocols(this.credential));
      this.socket = socket;

      socket.onopen = () => {
        for (const frame of this.adapter.openingFrames(this.config)) this.send(frame);
      };

      socket.onmessage = ({ data }) => {
        void this.handleMessage(data, finish);
      };

      socket.onerror = () => finish(new Error('REALTIME_CONNECTION_FAILED'));

      socket.onclose = (event) => {
        if (this.socket === socket) this.socket = null;
        this.ready = false;
        // Read before `finish`, which sets it: a close during connection is the
        // rejection, while a close after one is news the page has to hear —
        // nothing else will ever arrive to tell it the far end hung up.
        const wasRunning = this.settled;
        finish(new Error('REALTIME_CONNECTION_FAILED'));
        if (wasRunning) {
          this.onEvent({ kind: 'error', message: event?.reason || 'REALTIME_CONNECTION_CLOSED' });
        }
      };
    });
  }

  /**
   * Server frames arrive as text from one provider and as binary from another,
   * so both are decoded here rather than assumed.
   */
  private async handleMessage(data: unknown, finish: (error?: Error) => void): Promise<void> {
    let text: string;
    if (typeof data === 'string') {
      text = data;
    } else if (data instanceof Blob) {
      text = await data.text();
    } else if (data instanceof ArrayBuffer) {
      text = new TextDecoder().decode(data);
    } else {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // A malformed frame is isolated to that frame; the session continues.
      return;
    }

    for (const event of this.adapter.parse(parsed)) {
      if (event.kind === 'ready') {
        this.ready = true;
        finish();
        continue;
      }
      this.onEvent(event);
    }
  }

  appendAudio(pcm16Base64: string): boolean {
    if (!this.isOpen() || !this.ready) return false;
    for (const frame of this.adapter.audioFrames(pcm16Base64)) this.send(frame);
    return true;
  }

  sendToolResult(callId: string, name: string, output: Record<string, unknown>): boolean {
    if (!this.isOpen()) return false;
    for (const frame of this.adapter.toolResultFrames(callId, name, output)) this.send(frame);
    return true;
  }

  interrupt(): void {
    if (!this.isOpen()) return;
    for (const frame of this.adapter.interruptFrames()) this.send(frame);
  }

  disconnect(): void {
    // Settled before the socket is touched, so a caller awaiting `connect` is
    // released now rather than when the ready timer eventually fires.
    this.abandon?.(new Error('REALTIME_CONNECTION_CLOSED'));
    this.abandon = null;

    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    if (!socket) return;
    // Detached first: a close raised by our own teardown is not a dropped
    // connection and must not be reported to the page as one.
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    socket.close();
  }

  private isOpen(): boolean {
    return this.socket?.readyState === OPEN;
  }

  private send(event: object): void {
    this.socket?.send(JSON.stringify(event));
  }
}
