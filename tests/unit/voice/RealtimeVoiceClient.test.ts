import { describe, expect, it, vi } from 'vitest';
import { RealtimeVoiceClient, type RealtimeSocket } from '@/renderer/pages/voice/RealtimeVoiceClient';

class FakeSocket implements RealtimeSocket {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe('RealtimeVoiceClient', () => {
  it('opens a configured session and emits normalized server events', async () => {
    const socket = new FakeSocket();
    const onEvent = vi.fn();
    const client = new RealtimeVoiceClient({
      endpoint: 'ws://127.0.0.1:8765/v1/realtime',
      language: 'tr',
      createSocket: () => socket,
      onEvent,
    });

    const connected = client.connect();
    socket.readyState = 1;
    socket.onopen?.();
    await connected;

    expect(JSON.parse(socket.sent[0])).toMatchObject({ type: 'session.update' });
    socket.onmessage?.({ data: JSON.stringify({ type: 'response.audio_transcript.delta', delta: 'Merhaba' }) });
    expect(onEvent).toHaveBeenCalledWith({ kind: 'assistant-transcript', text: 'Merhaba', final: false });
  });

  it('sends audio and interrupt events only after connection', async () => {
    const socket = new FakeSocket();
    const client = new RealtimeVoiceClient({
      endpoint: 'ws://localhost:8765/v1/realtime',
      language: 'en',
      createSocket: () => socket,
      onEvent: vi.fn(),
    });

    expect(client.appendAudio('AQI=')).toBe(false);
    const connected = client.connect();
    socket.readyState = 1;
    socket.onopen?.();
    await connected;

    expect(client.appendAudio('AQI=')).toBe(true);
    client.interrupt();
    expect(socket.sent.slice(1).map((item) => JSON.parse(item))).toEqual([
      { type: 'input_audio_buffer.append', audio: 'AQI=' },
      { type: 'response.cancel' },
    ]);
  });

  it('rejects an unsafe endpoint before opening a socket', async () => {
    const createSocket = vi.fn(() => new FakeSocket());
    const client = new RealtimeVoiceClient({
      endpoint: 'ws://voice.example.com/v1/realtime',
      language: 'en',
      createSocket,
      onEvent: vi.fn(),
    });

    await expect(client.connect()).rejects.toThrow('Unsafe realtime endpoint');
    expect(createSocket).not.toHaveBeenCalled();
  });
});
