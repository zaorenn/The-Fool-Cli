import { describe, expect, it } from 'vitest';
import { getRealtimeAdapter, REALTIME_TOOLS, validateRealtimeEndpoint } from '@/common/realtime';
import type { RealtimeCredential, RealtimeSessionConfig } from '@/common/realtime';

const config: RealtimeSessionConfig = {
  model: 'gpt-realtime',
  voice: 'marin',
  instructions: 'Be an English teacher.',
  language: 'tr',
  tools: REALTIME_TOOLS,
};

const credential = (providerId: RealtimeCredential['providerId'], endpoint = ''): RealtimeCredential => ({
  providerId,
  token: 'sk-test',
  endpoint,
  ephemeral: false,
});

describe('OpenAI realtime adapter', () => {
  const adapter = getRealtimeAdapter('openai-realtime');

  it('configures the session with the persona, the voice and a listening rate', () => {
    const [frame] = adapter.openingFrames(config) as [{ session: Record<string, any> }];
    expect(frame.session.instructions).toBe('Be an English teacher.');
    expect(frame.session.audio.output.voice).toBe('marin');
    expect(frame.session.audio.input.format).toEqual({ type: 'audio/pcm', rate: 24000 });
  });

  it('omits the transcription language rather than sending "auto" as a code', () => {
    const [frame] = adapter.openingFrames({ ...config, language: 'auto' }) as [{ session: Record<string, any> }];
    expect(frame.session.audio.input.transcription).toEqual({ model: 'gpt-4o-mini-transcribe' });
  });

  it('reduces a full locale to the two-letter code the transcriber accepts', () => {
    const [frame] = adapter.openingFrames({ ...config, language: 'pt-BR' }) as [{ session: Record<string, any> }];
    expect(frame.session.audio.input.transcription.language).toBe('pt');
  });

  it('reads audio deltas under both the released and the beta event names', () => {
    expect(adapter.parse({ type: 'response.output_audio.delta', delta: 'AQI=' })).toEqual([
      { kind: 'audio', pcm16Base64: 'AQI=' },
    ]);
    expect(adapter.parse({ type: 'response.audio.delta', delta: 'AQI=' })).toEqual([
      { kind: 'audio', pcm16Base64: 'AQI=' },
    ]);
  });

  it('treats the user starting to talk as a flush before a phase change', () => {
    expect(adapter.parse({ type: 'input_audio_buffer.speech_started' })).toEqual([
      { kind: 'interrupted' },
      { kind: 'phase', phase: 'listening' },
    ]);
  });

  it('ignores a function call that arrives without its identifier', () => {
    expect(
      adapter.parse({ type: 'response.function_call_arguments.done', name: 'app_ask_jester', arguments: '{}' })
    ).toEqual([]);
  });

  it('surfaces a nested error message and drops a frame that carries none', () => {
    expect(adapter.parse({ type: 'error', error: { message: 'invalid_api_key' } })).toEqual([
      { kind: 'error', message: 'invalid_api_key' },
    ]);
    expect(adapter.parse({ type: 'error', error: {} })).toEqual([]);
  });

  it('carries the key in a subprotocol and the model in the query string', () => {
    expect(adapter.subprotocols(credential('openai-realtime'))).toContain('openai-insecure-api-key.sk-test');
    expect(adapter.buildUrl(credential('openai-realtime', 'wss://api.openai.com/v1/realtime'), config)).toBe(
      'wss://api.openai.com/v1/realtime?model=gpt-realtime'
    );
  });
});

describe('Gemini Live adapter', () => {
  const adapter = getRealtimeAdapter('gemini-live');

  it('names the model as a resource and asks for both transcriptions', () => {
    const [frame] = adapter.openingFrames(config) as [{ setup: Record<string, any> }];
    expect(frame.setup.model).toBe('models/gpt-realtime');
    expect(frame.setup.inputAudioTranscription).toEqual({});
    expect(frame.setup.outputAudioTranscription).toEqual({});
  });

  it('expands a bare language into the locale speechConfig requires', () => {
    const [frame] = adapter.openingFrames(config) as [{ setup: Record<string, any> }];
    expect(frame.setup.generationConfig.speechConfig.languageCode).toBe('tr-TR');
  });

  it('sends no language at all when the model should follow the speaker', () => {
    const [frame] = adapter.openingFrames({ ...config, language: 'auto' }) as [{ setup: Record<string, any> }];
    expect(frame.setup.generationConfig.speechConfig.languageCode).toBeUndefined();
  });

  it('puts the interruption ahead of audio arriving in the same frame', () => {
    const events = adapter.parse({
      serverContent: {
        interrupted: true,
        modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AQI=' } }] },
      },
    });
    expect(events[0]).toEqual({ kind: 'interrupted' });
    expect(events).toContainEqual({ kind: 'audio', pcm16Base64: 'AQI=' });
  });

  it('keeps input and output transcripts apart', () => {
    expect(
      adapter.parse({
        serverContent: { inputTranscription: { text: 'merhaba' }, outputTranscription: { text: 'hello' } },
      })
    ).toEqual([
      { kind: 'user-transcript', text: 'merhaba', final: false },
      { kind: 'assistant-transcript', text: 'hello', final: false },
    ]);
  });

  it('skips a non-audio inline part rather than queueing it as sound', () => {
    expect(
      adapter.parse({
        serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AQI=' } }] } },
      })
    ).toEqual([]);
  });

  it('falls back to the function name when a tool call has no id', () => {
    expect(
      adapter.parse({ toolCall: { functionCalls: [{ name: 'app_change_theme', args: { tone: 'teal' } }] } })
    ).toEqual([
      { kind: 'tool-call', callId: 'app_change_theme', name: 'app_change_theme', argumentsJson: '{"tone":"teal"}' },
    ]);
  });

  it('puts the key in the query string, since it has no subprotocol', () => {
    expect(adapter.subprotocols(credential('gemini-live'))).toEqual([]);
    expect(adapter.buildUrl(credential('gemini-live'), config)).toContain('key=sk-test');
  });

  it('listens at 16 kHz while answering at 24 kHz', () => {
    expect(adapter.inputSampleRate).toBe(16000);
    expect(adapter.outputSampleRate).toBe(24000);
  });
});

describe('local speech-to-speech adapter', () => {
  const adapter = getRealtimeAdapter('local-s2s');

  it('opens with the flat session shape the local pipeline understands', () => {
    const [frame] = adapter.openingFrames(config) as [{ session: Record<string, any> }];
    expect(frame.session.input_audio_format).toBe('pcm16');
    expect(frame.session.turn_detection.type).toBe('server_vad');
  });

  it('connects to the loopback endpoint it was handed', () => {
    expect(adapter.buildUrl(credential('local-s2s', 'ws://127.0.0.1:8765/v1/realtime'), config)).toBe(
      'ws://127.0.0.1:8765/v1/realtime'
    );
  });
});

describe('realtime endpoint safety', () => {
  it('allows an encrypted endpoint anywhere', () => {
    expect(validateRealtimeEndpoint('wss://api.openai.com/v1/realtime')).toBe(true);
  });

  it('allows a plain socket only against this machine', () => {
    expect(validateRealtimeEndpoint('ws://127.0.0.1:8765/v1/realtime')).toBe(true);
    expect(validateRealtimeEndpoint('ws://voice.example.com/v1/realtime')).toBe(false);
  });

  it('refuses something that is not a URL at all', () => {
    expect(validateRealtimeEndpoint('not a url')).toBe(false);
  });
});

describe('realtime tool schemas', () => {
  it('names tools without a dot, which Gemini rejects in a function name', () => {
    for (const tool of REALTIME_TOOLS) expect(tool.name).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  /**
   * Opening a page is its own tool, not a task for the desktop agent.
   *
   * "Open YouTube for me" used to go to `app_ask_jester`, which drives the
   * machine by hand: minutes of clicking to do what handing a URL to the
   * user's own browser does at once, and it failed outright whenever the agent
   * was unavailable.
   */
  it('offers opening a page as a tool of its own, taking a URL', () => {
    const open = REALTIME_TOOLS.find((tool) => tool.name === 'app_open_url');

    expect(open?.parameters.required).toEqual(['url']);
    expect(open?.parameters.properties).toHaveProperty('url');
    // The description is what decides whether the model reaches for this or for
    // the agent, so the distinction has to be stated in it.
    expect(open?.description).toMatch(/browser/i);
  });
});
