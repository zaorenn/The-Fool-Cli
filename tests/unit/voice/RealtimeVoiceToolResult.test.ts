import { describe, expect, it, vi } from 'vitest';
import { REALTIME_TOOLS, type RealtimeCredential, type RealtimeSessionConfig } from '@/common/realtime';
import { RealtimeVoiceClient, type RealtimeSocket } from '@/renderer/pages/voice/RealtimeVoiceClient';

const config: RealtimeSessionConfig = {
  model: 'gpt-realtime',
  voice: 'marin',
  instructions: 'Be brief.',
  language: 'tr',
  tools: REALTIME_TOOLS,
};

const createOpenSocket = (): RealtimeSocket => ({
  readyState: 1,
  onopen: null,
  onmessage: null,
  onerror: null,
  onclose: null,
  send: vi.fn(),
  close: vi.fn(),
});

/** Each provider acknowledges a session in its own words, so the ack follows it. */
const ACKNOWLEDGEMENT: Record<string, object> = {
  'local-s2s': { type: 'session.created' },
  'openai-realtime': { type: 'session.created' },
  'gemini-live': { setupComplete: {} },
};

const connect = async (socket: RealtimeSocket, credential: Partial<RealtimeCredential> = {}) => {
  const resolved: RealtimeCredential = {
    providerId: 'local-s2s',
    token: '',
    endpoint: 'ws://127.0.0.1:8765/v1/realtime',
    ephemeral: false,
    ...credential,
  };
  const client = new RealtimeVoiceClient({
    credential: resolved,
    config,
    createSocket: () => socket,
    onEvent: vi.fn(),
  });

  const connecting = client.connect();
  socket.onopen?.();
  socket.onmessage?.({ data: JSON.stringify(ACKNOWLEDGEMENT[resolved.providerId]) });
  await connecting;
  vi.mocked(socket.send).mockClear();
  return client;
};

describe('RealtimeVoiceClient tool results', () => {
  it('returns the result and asks the model to carry on speaking', async () => {
    const socket = createOpenSocket();
    const client = await connect(socket);

    expect(client.sendToolResult('call-7', 'app_change_theme', { ok: true })).toBe(true);
    expect(socket.send).toHaveBeenNthCalledWith(
      1,
      JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: 'call-7', output: JSON.stringify({ ok: true }) },
      })
    );
    expect(socket.send).toHaveBeenNthCalledWith(2, JSON.stringify({ type: 'response.create' }));
  });

  it('answers Gemini in its own shape, with the function named alongside the id', async () => {
    const socket = createOpenSocket();
    const client = await connect(socket, { providerId: 'gemini-live', token: 'key', endpoint: '' });

    expect(client.sendToolResult('call-9', 'app_ask_jester', { ok: true })).toBe(true);
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({
        toolResponse: { functionResponses: [{ id: 'call-9', name: 'app_ask_jester', response: { ok: true } }] },
      })
    );
  });

  it('reports a failed result rather than swallowing it', async () => {
    const socket = createOpenSocket();
    const client = await connect(socket);

    client.sendToolResult('call-8', 'app_change_theme', { ok: false, error: 'Unsupported tone' });
    expect(vi.mocked(socket.send).mock.calls[0][0]).toContain('Unsupported tone');
  });

  it('does not claim delivery when disconnected', () => {
    const client = new RealtimeVoiceClient({
      credential: {
        providerId: 'local-s2s',
        token: '',
        endpoint: 'ws://127.0.0.1:8765/v1/realtime',
        ephemeral: false,
      },
      config,
      onEvent: vi.fn(),
    });

    expect(client.sendToolResult('call-8', 'app_change_theme', { ok: false })).toBe(false);
  });
});
