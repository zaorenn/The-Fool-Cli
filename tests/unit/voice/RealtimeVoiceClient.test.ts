import { describe, expect, it, vi } from 'vitest';
import { REALTIME_TOOLS, type RealtimeCredential, type RealtimeSessionConfig } from '@/common/realtime';
import { RealtimeVoiceClient, type RealtimeSocket } from '@/renderer/pages/voice/RealtimeVoiceClient';

class FakeSocket implements RealtimeSocket {
  readyState = 0;
  sent: string[] = [];
  protocols: readonly string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event?: { code?: number; reason?: string }) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  /** Brings the socket up and acknowledges the session, as a provider would. */
  acknowledge(frame: object = { type: 'session.created' }): void {
    this.readyState = 1;
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const config: RealtimeSessionConfig = {
  model: 'gpt-realtime',
  voice: 'marin',
  instructions: 'Be brief.',
  language: 'tr',
  tools: REALTIME_TOOLS,
};

const localCredential: RealtimeCredential = {
  providerId: 'local-s2s',
  token: '',
  endpoint: 'ws://127.0.0.1:8765/v1/realtime',
  ephemeral: false,
};

const build = (socket: FakeSocket, overrides: Partial<RealtimeCredential> = {}) => {
  const onEvent = vi.fn();
  const client = new RealtimeVoiceClient({
    credential: { ...localCredential, ...overrides },
    config,
    createSocket: (_url, protocols) => {
      socket.protocols = protocols;
      return socket;
    },
    onEvent,
  });
  return { client, onEvent };
};

describe('RealtimeVoiceClient connection', () => {
  it('sends the session frame on open and resolves once it is acknowledged', async () => {
    const socket = new FakeSocket();
    const { client } = build(socket);

    const connecting = client.connect();
    socket.acknowledge();
    await connecting;

    expect(JSON.parse(socket.sent[0])).toMatchObject({ type: 'session.update' });
  });

  it('stays pending while the socket is open but the session is not acknowledged', async () => {
    const socket = new FakeSocket();
    const { client } = build(socket);

    const connecting = client.connect();
    socket.readyState = 1;
    socket.onopen?.();

    const settled = await Promise.race([connecting.then(() => 'resolved'), Promise.resolve('pending')]);
    expect(settled).toBe('pending');
  });

  it('rejects an unsafe endpoint without opening a socket', async () => {
    const createSocket = vi.fn(() => new FakeSocket());
    const client = new RealtimeVoiceClient({
      credential: { ...localCredential, endpoint: 'ws://voice.example.com/v1/realtime' },
      config,
      createSocket,
      onEvent: vi.fn(),
    });

    await expect(client.connect()).rejects.toThrow('REALTIME_UNSAFE_ENDPOINT');
    expect(createSocket).not.toHaveBeenCalled();
  });

  it('rejects when the connection fails before the session is acknowledged', async () => {
    const socket = new FakeSocket();
    const { client } = build(socket);

    const connecting = client.connect();
    socket.onerror?.();

    await expect(connecting).rejects.toThrow('REALTIME_CONNECTION_FAILED');
  });

  it('reports a connection dropped after the session was running', async () => {
    const socket = new FakeSocket();
    const { client, onEvent } = build(socket);

    const connecting = client.connect();
    socket.acknowledge();
    await connecting;

    socket.onclose?.({ reason: 'rate_limited' });
    expect(onEvent).toHaveBeenCalledWith({ kind: 'error', message: 'rate_limited' });
  });

  it('stays silent when the caller is the one closing the socket', async () => {
    const socket = new FakeSocket();
    const { client, onEvent } = build(socket);

    const connecting = client.connect();
    socket.acknowledge();
    await connecting;
    onEvent.mockClear();

    client.disconnect();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('passes the provider its authenticating subprotocols', async () => {
    const socket = new FakeSocket();
    const { client } = build(socket, {
      providerId: 'openai-realtime',
      token: 'sk-live',
      endpoint: 'wss://api.openai.com/v1/realtime',
    });

    const connecting = client.connect();
    socket.acknowledge();
    await connecting;

    expect(socket.protocols).toContain('openai-insecure-api-key.sk-live');
  });
});

describe('RealtimeVoiceClient traffic', () => {
  it('refuses to send audio before the session is acknowledged', async () => {
    const socket = new FakeSocket();
    const { client } = build(socket);

    expect(client.appendAudio('AQI=')).toBe(false);
    const connecting = client.connect();
    socket.readyState = 1;
    socket.onopen?.();
    expect(client.appendAudio('AQI=')).toBe(false);

    socket.onmessage?.({ data: JSON.stringify({ type: 'session.created' }) });
    await connecting;
    expect(client.appendAudio('AQI=')).toBe(true);
  });

  it('emits the events a provider sends after the session opens', async () => {
    const socket = new FakeSocket();
    const { client, onEvent } = build(socket);

    const connecting = client.connect();
    socket.acknowledge();
    await connecting;

    socket.onmessage?.({ data: JSON.stringify({ type: 'response.audio_transcript.delta', delta: 'Merhaba' }) });
    expect(onEvent).toHaveBeenCalledWith({ kind: 'assistant-transcript', text: 'Merhaba', final: false });
  });

  it('decodes a frame that arrives as binary rather than text', async () => {
    const socket = new FakeSocket();
    const { client, onEvent } = build(socket);

    const connecting = client.connect();
    socket.acknowledge();
    await connecting;

    const frame = JSON.stringify({ type: 'response.output_audio.delta', delta: 'AQI=' });
    socket.onmessage?.({ data: new TextEncoder().encode(frame).buffer });
    await Promise.resolve();

    expect(onEvent).toHaveBeenCalledWith({ kind: 'audio', pcm16Base64: 'AQI=' });
  });

  it('survives a malformed frame without ending the session', async () => {
    const socket = new FakeSocket();
    const { client, onEvent } = build(socket);

    const connecting = client.connect();
    socket.acknowledge();
    await connecting;
    onEvent.mockClear();

    socket.onmessage?.({ data: '{ not json' });
    expect(onEvent).not.toHaveBeenCalled();
    expect(client.appendAudio('AQI=')).toBe(true);
  });

  it('exposes the rates the chosen provider listens and answers at', () => {
    const socket = new FakeSocket();
    const { client } = build(socket, { providerId: 'gemini-live', token: 'key', endpoint: '' });
    expect(client.inputSampleRate).toBe(16000);
    expect(client.outputSampleRate).toBe(24000);
  });
});
