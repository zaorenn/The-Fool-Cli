import { describe, expect, it, vi } from 'vitest';
import { RealtimeVoiceClient, type RealtimeSocket } from '@/renderer/pages/voice/RealtimeVoiceClient';

const createOpenSocket = () => {
  const socket: RealtimeSocket = {
    readyState: 1,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send: vi.fn(),
    close: vi.fn(),
  };
  return socket;
};

describe('RealtimeVoiceClient tool results', () => {
  it('returns a completed tool result to the realtime model and resumes the response', async () => {
    const socket = createOpenSocket();
    const client = new RealtimeVoiceClient({
      endpoint: 'ws://127.0.0.1:8765/v1/realtime',
      language: 'tr',
      createSocket: () => socket,
      onEvent: vi.fn(),
    });

    const connecting = client.connect();
    socket.onopen?.();
    await connecting;
    vi.mocked(socket.send).mockClear();

    expect(client.sendToolResult('call-7', { ok: true, tone: 'blue' })).toBe(true);
    expect(socket.send).toHaveBeenNthCalledWith(
      1,
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: 'call-7',
          output: JSON.stringify({ ok: true, tone: 'blue' }),
        },
      })
    );
    expect(socket.send).toHaveBeenNthCalledWith(2, JSON.stringify({ type: 'response.create' }));
  });

  it('does not claim delivery when disconnected', () => {
    const client = new RealtimeVoiceClient({
      endpoint: 'ws://127.0.0.1:8765/v1/realtime',
      language: 'en',
      onEvent: vi.fn(),
    });

    expect(client.sendToolResult('call-8', { ok: false })).toBe(false);
  });
});
