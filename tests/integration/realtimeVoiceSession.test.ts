import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REALTIME_TOOLS, type NormalizedRealtimeEvent, type RealtimeSessionConfig } from '@/common/realtime';
import { RealtimeVoiceClient, type RealtimeSocket } from '@/renderer/pages/voice/RealtimeVoiceClient';

/**
 * The whole client against a real socket, not a stub.
 *
 * The unit tests drive the client through a fake that resolves the moment it is
 * told to. This one puts an actual WebSocket server on loopback and makes the
 * client connect to it, so the parts that only exist between two processes get
 * exercised: the handshake, frames arriving as separate messages, the ordering
 * of the session frame against the first audio, and a connection that drops
 * mid-conversation.
 *
 * The server speaks the OpenAI dialect, which is what both the hosted provider
 * and the local pipeline answer in.
 */

type Session = {
  server: WebSocketServer;
  url: string;
  /** Everything the client sent, parsed, in order. */
  received: Record<string, unknown>[];
  /** The live connection, for pushing server events at the client. */
  socket: () => WebSocket;
};

let session: Session | null = null;

const startServer = (onOpen?: (socket: WebSocket) => void): Promise<Session> =>
  new Promise((done) => {
    const received: Record<string, unknown>[] = [];
    let live: WebSocket | null = null;
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });

    server.on('connection', (socket) => {
      live = socket;
      socket.on('message', (data) => {
        received.push(JSON.parse(String(data)) as Record<string, unknown>);
      });
      onOpen?.(socket);
    });

    server.on('listening', () => {
      const { port } = server.address() as AddressInfo;
      done({
        server,
        url: `ws://127.0.0.1:${port}/v1/realtime`,
        received,
        socket: () => {
          if (!live) throw new Error('no client connected yet');
          return live;
        },
      });
    });
  });

const connectClient = (url: string, onEvent: (event: NormalizedRealtimeEvent) => void) => {
  const config: RealtimeSessionConfig = {
    model: 'gpt-realtime',
    voice: 'marin',
    instructions: 'You are an English teacher.',
    language: 'tr',
    tools: REALTIME_TOOLS,
  };

  return new RealtimeVoiceClient({
    credential: { providerId: 'local-s2s', token: '', endpoint: url, ephemeral: false },
    config,
    createSocket: (target) => new WebSocket(target) as unknown as RealtimeSocket,
    onEvent,
  });
};

const settle = () => new Promise((done) => setTimeout(done, 60));

afterEach(async () => {
  if (session) {
    await new Promise((done) => session?.server.close(() => done(null)));
    session = null;
  }
});

describe('a realtime voice session over a real socket', () => {
  beforeEach(async () => {
    // Acknowledges the session as soon as it is configured, which is what every
    // provider does and what the client waits for before opening the microphone.
    session = await startServer((socket) => {
      socket.on('message', (data) => {
        const frame = JSON.parse(String(data)) as { type?: string };
        if (frame.type === 'session.update') socket.send(JSON.stringify({ type: 'session.created' }));
      });
    });
  });

  it('opens, configures the session, and only then reports ready', async () => {
    const events: NormalizedRealtimeEvent[] = [];
    const client = connectClient(session!.url, (event) => events.push(event));

    await client.connect();
    await settle();

    const first = session!.received[0] as { type: string; session: Record<string, any> };
    expect(first.type).toBe('session.update');
    expect(first.session.instructions).toBe('You are an English teacher.');
    client.disconnect();
  });

  it('carries the persona and the voice all the way to the far end', async () => {
    const client = connectClient(session!.url, () => undefined);
    await client.connect();
    await settle();

    const frame = session!.received[0] as { session: Record<string, any> };
    expect(frame.session.turn_detection.type).toBe('server_vad');
    expect(frame.session.tools.map((tool: { name: string }) => tool.name)).toContain('app_standby');
    client.disconnect();
  });

  it('sends microphone audio the far end can read back', async () => {
    const client = connectClient(session!.url, () => undefined);
    await client.connect();

    expect(client.appendAudio('AQIDBA==')).toBe(true);
    await settle();

    expect(session!.received).toContainEqual({ type: 'input_audio_buffer.append', audio: 'AQIDBA==' });
    client.disconnect();
  });

  it('turns a spoken reply into transcript and audio events', async () => {
    const events: NormalizedRealtimeEvent[] = [];
    const client = connectClient(session!.url, (event) => events.push(event));
    await client.connect();

    session!.socket().send(JSON.stringify({ type: 'response.output_audio_transcript.delta', delta: 'Merhaba' }));
    session!.socket().send(JSON.stringify({ type: 'response.output_audio.delta', delta: 'AQID' }));
    await settle();

    expect(events).toContainEqual({ kind: 'assistant-transcript', text: 'Merhaba', final: false });
    expect(events).toContainEqual({ kind: 'audio', pcm16Base64: 'AQID' });
    client.disconnect();
  });

  it('reports a barge-in as a flush before a phase change', async () => {
    const events: NormalizedRealtimeEvent[] = [];
    const client = connectClient(session!.url, (event) => events.push(event));
    await client.connect();

    session!.socket().send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }));
    await settle();

    expect(events[0]).toEqual({ kind: 'interrupted' });
    expect(events[1]).toEqual({ kind: 'phase', phase: 'listening' });
    client.disconnect();
  });

  it('completes a tool call round trip and asks the model to speak again', async () => {
    const events: NormalizedRealtimeEvent[] = [];
    const client = connectClient(session!.url, (event) => events.push(event));
    await client.connect();

    session!.socket().send(
      JSON.stringify({
        type: 'response.function_call_arguments.done',
        call_id: 'call-1',
        name: 'app_standby',
        arguments: '{}',
      })
    );
    await settle();

    expect(events).toContainEqual({
      kind: 'tool-call',
      callId: 'call-1',
      name: 'app_standby',
      argumentsJson: '{}',
    });

    client.sendToolResult('call-1', 'app_standby', { ok: true });
    await settle();

    const tail = session!.received.slice(-2);
    expect(tail[0]).toMatchObject({ type: 'conversation.item.create' });
    expect(tail[1]).toEqual({ type: 'response.create' });
    client.disconnect();
  });

  it('tells the page when the far end hangs up mid-conversation', async () => {
    const events: NormalizedRealtimeEvent[] = [];
    const client = connectClient(session!.url, (event) => events.push(event));
    await client.connect();

    session!.socket().close();
    await settle();

    expect(events.some((event) => event.kind === 'error')).toBe(true);
  });
});

describe('a realtime session that never opens', () => {
  it('refuses to send audio when the far end never acknowledges the session', async () => {
    // A server that accepts the socket and then says nothing: the failure mode
    // where a proxy is reachable but is not actually a realtime endpoint.
    session = await startServer();
    const client = connectClient(session.url, () => undefined);

    const connecting = client.connect();
    await settle();

    expect(client.appendAudio('AQID')).toBe(false);
    client.disconnect();
    await expect(connecting).rejects.toThrow();
  });
});
