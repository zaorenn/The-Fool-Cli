/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedRealtimeEvent } from '@/common/realtime';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings, type VoiceModel } from '@/common/types/foolVoice';

const catalogInvoke = vi.fn();
const transcribeInvoke = vi.fn();
const synthesizeInvoke = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    foolVoice: {
      catalog: { invoke: (request: unknown) => catalogInvoke(request) },
      transcribe: { invoke: (request: unknown) => transcribeInvoke(request) },
      synthesize: { invoke: (request: unknown) => synthesizeInvoke(request) },
    },
  },
}));

const {
  LocalVoicePipeline,
  checkLocalReadiness,
  listLocalModels,
  normalizeEndpoint,
  pcm16ToWavBase64,
  wavToPcm16Base64,
} = await import('@renderer/pages/voice/localPipeline');

const STT_MODEL: VoiceModel = {
  id: 'stt-whisper-turbo',
  providerId: 'local-sherpa',
  displayName: 'Whisper Turbo',
  languages: ['en', 'tr'],
  distribution: 'managed',
  state: { status: 'ready' },
  downloadBytes: null,
  installedBytes: null,
  role: 'speech-to-text',
  audioInput: { container: 'wav', encoding: 'pcm16le', sampleRateHz: 16000, channels: 1 },
};

const TTS_MODEL: VoiceModel = {
  id: 'tts-audiocpp-chatterbox',
  providerId: 'local-audiocpp',
  displayName: 'Chatterbox',
  languages: ['en'],
  distribution: 'managed',
  state: { status: 'ready' },
  downloadBytes: null,
  installedBytes: null,
  role: 'text-to-speech',
  audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 },
  profileIds: [],
};

const settingsWith = (change: Partial<FoolVoiceSettings['realtime']> = {}): FoolVoiceSettings => ({
  ...structuredClone(DEFAULT_FOOL_VOICE_SETTINGS),
  stt: { ...DEFAULT_FOOL_VOICE_SETTINGS.stt, modelId: STT_MODEL.id },
  tts: { ...DEFAULT_FOOL_VOICE_SETTINGS.tts, modelId: TTS_MODEL.id, profileId: 'cloned:jarvis' },
  realtime: { ...DEFAULT_FOOL_VOICE_SETTINGS.realtime, providerId: 'local-pipeline', ...change },
});

const okCatalog = (models: readonly VoiceModel[]) => ({ ok: true, data: { models, profiles: [] } });

/** An OpenAI-dialect stream body, one `data:` line per delta. */
const sseBody = (deltas: readonly string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const lines = [
    ...deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n`),
    'data: [DONE]\n',
  ];
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
};

/**
 * A stream that thinks out loud before answering, as the local models do.
 *
 * Verified against LM Studio serving `google/gemma-4-e4b`: it emits a run of
 * `reasoning_content` deltas — its private working-out, in English, whatever
 * language the answer is in — before the first `content` delta arrives.
 */
const thinkingSseBody = (thoughts: readonly string[], deltas: readonly string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const lines = [
    ...thoughts.map((thought) => `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: thought } }] })}\n`),
    ...deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n`),
    'data: [DONE]\n',
  ];
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
};

const pcmOf = (values: readonly number[]): Uint8Array => {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt16(index * 2, value, true));
  return bytes;
};

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/** Lets everything already queued on the microtask loop settle. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
};

beforeEach(() => {
  catalogInvoke.mockReset();
  transcribeInvoke.mockReset();
  synthesizeInvoke.mockReset();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('wav framing', () => {
  it('returns the samples it was given, through a header and back', () => {
    const pcm = pcmOf([0, 1000, -1000, 32767, -32768]);
    expect(wavToPcm16Base64(pcm16ToWavBase64(pcm, 16000))).toBe(toBase64(pcm));
  });

  it('finds the data chunk behind one the engine wrote first', () => {
    const pcm = pcmOf([7, -7]);
    const wav = Buffer.from(pcm16ToWavBase64(pcm, 24000), 'base64');
    // A `LIST` chunk of 6 bytes, spliced in ahead of `data`.
    const list = Buffer.alloc(14);
    list.write('LIST', 0, 'ascii');
    list.writeUInt32LE(6, 4);
    const spliced = Buffer.concat([wav.subarray(0, 36), list, wav.subarray(36)]);

    expect(wavToPcm16Base64(spliced.toString('base64'))).toBe(toBase64(pcm));
  });

  it('leaves audio alone that was never wrapped', () => {
    const raw = toBase64(pcmOf([3, 4, 5]));
    expect(wavToPcm16Base64(raw)).toBe(raw);
  });

  it('stops at the end of the file when the header claims more than arrived', () => {
    const pcm = pcmOf([1, 2]);
    const wav = Buffer.from(pcm16ToWavBase64(pcm, 16000), 'base64');
    wav.writeUInt32LE(9999, 40);
    expect(wavToPcm16Base64(wav.toString('base64'))).toBe(toBase64(pcm));
  });
});

describe('normalizeEndpoint', () => {
  it('falls back to LM Studio when nothing is configured', () => {
    expect(normalizeEndpoint('  ')).toBe('http://127.0.0.1:1234/v1');
  });

  it('drops a trailing slash rather than doubling it in the path', () => {
    expect(normalizeEndpoint('http://127.0.0.1:9000/v1/')).toBe('http://127.0.0.1:9000/v1');
  });
});

describe('checkLocalReadiness', () => {
  it('names the transcriber as the missing piece when none is installed', async () => {
    catalogInvoke.mockResolvedValue(okCatalog([TTS_MODEL]));
    await expect(checkLocalReadiness(settingsWith())).resolves.toEqual({ ok: false, reason: 'stt-missing' });
  });

  it('names the voice as the missing piece when nothing can speak', async () => {
    catalogInvoke.mockResolvedValue(okCatalog([STT_MODEL]));
    await expect(checkLocalReadiness(settingsWith())).resolves.toEqual({ ok: false, reason: 'tts-missing' });
  });

  it('distinguishes a server that is down from one with nothing loaded', async () => {
    catalogInvoke.mockResolvedValue(okCatalog([STT_MODEL, TTS_MODEL]));

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(checkLocalReadiness(settingsWith())).resolves.toEqual({ ok: false, reason: 'llm-unreachable' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }));
    await expect(checkLocalReadiness(settingsWith())).resolves.toEqual({ ok: false, reason: 'no-llm-model' });
  });

  it('keeps the configured model when the server has it, and substitutes when it does not', async () => {
    catalogInvoke.mockResolvedValue(okCatalog([STT_MODEL, TTS_MODEL]));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: 'qwen/qwen3-14b' }, { id: 'google/gemma-4-e4b' }] }),
      })
    );

    const chosen = await checkLocalReadiness(settingsWith({ model: 'google/gemma-4-e4b' }));
    expect(chosen).toMatchObject({ ok: true, llmModelId: 'google/gemma-4-e4b' });

    // A model that was uninstalled since it was configured must not be the
    // reason the conversation refuses to open.
    const stale = await checkLocalReadiness(settingsWith({ model: 'a-model-that-left' }));
    expect(stale).toMatchObject({ ok: true, llmModelId: 'qwen/qwen3-14b' });
  });
});

describe('listLocalModels', () => {
  it('answers with nothing rather than throwing when the server is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(listLocalModels('')).resolves.toEqual([]);
  });

  it('reads the ids the server reports', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: 'a' }, { id: 7 }, { id: 'b' }] }) })
    );
    await expect(listLocalModels('http://127.0.0.1:1234/v1')).resolves.toEqual(['a', 'b']);
  });
});

describe('LocalVoicePipeline', () => {
  const readyCatalog = () => catalogInvoke.mockResolvedValue(okCatalog([STT_MODEL, TTS_MODEL]));

  const connect = async (events: NormalizedRealtimeEvent[], chat: () => Response | Promise<Response>) => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'google/gemma-4-e4b' }] }) } as unknown as Response;
      }
      return chat();
    });
    vi.stubGlobal('fetch', fetchMock);

    const pipeline = new LocalVoicePipeline({
      settings: settingsWith({ model: 'google/gemma-4-e4b' }),
      interfaceLanguage: 'tr',
      onEvent: (event) => events.push(event),
    });
    await pipeline.connect();
    return { pipeline, fetchMock };
  };

  it('refuses to start with a reason the page can translate', async () => {
    catalogInvoke.mockResolvedValue(okCatalog([TTS_MODEL]));
    const pipeline = new LocalVoicePipeline({
      settings: settingsWith(),
      interfaceLanguage: 'en',
      onEvent: () => undefined,
    });
    await expect(pipeline.connect()).rejects.toThrow('LOCAL_STT_MISSING');
  });

  it('hears, thinks and speaks a turn, one sentence at a time', async () => {
    readyCatalog();
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: '  Merhaba, nasilsin?  ' } });
    synthesizeInvoke.mockImplementation(async () => ({
      ok: true,
      data: { audio: { dataBase64: pcm16ToWavBase64(pcmOf([1, 2, 3]), 22050), sampleRateHz: 22050 } },
    }));

    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline } = await connect(
      events,
      () =>
        ({
          ok: true,
          body: sseBody(['Iyiyim. ', 'Sen nasilsin?']),
        }) as unknown as Response
    );

    pipeline.pushAudio(toBase64(pcmOf([100, 200])), 'speech-started');
    pipeline.pushAudio(toBase64(pcmOf([300, 400])), 'speech');
    pipeline.pushAudio('', 'utterance-ended');
    await settle();

    // The transcriber is handed a real WAV of everything that was captured.
    const capture = transcribeInvoke.mock.calls[0][0].payload.audio;
    expect(capture.sampleRateHz).toBe(16000);
    expect(capture.byteLength).toBe(44 + 8);
    expect(wavToPcm16Base64(capture.dataBase64)).toBe(toBase64(pcmOf([100, 200, 300, 400])));

    // Two sentences, spoken separately, each carrying the text to say — the
    // whole point of the call, and the field the first draft of this left out.
    expect(synthesizeInvoke).toHaveBeenCalledTimes(2);
    const spoken = synthesizeInvoke.mock.calls.map((call) => call[0].payload.text);
    expect(spoken).toEqual(['Iyiyim.', 'Sen nasilsin?']);
    expect(synthesizeInvoke.mock.calls[0][0].payload).toMatchObject({
      providerId: 'local-audiocpp',
      modelId: TTS_MODEL.id,
      profileId: 'cloned:jarvis',
    });

    expect(events).toContainEqual({ kind: 'user-transcript', text: 'Merhaba, nasilsin?', final: true });
    // Samples, not the file: the header would be played as audio otherwise.
    expect(events).toContainEqual({
      kind: 'audio',
      pcm16Base64: toBase64(pcmOf([1, 2, 3])),
      sampleRate: 22050,
    });
    expect(events.filter((event) => event.kind === 'audio')).toHaveLength(2);
    expect(events.at(-1)).toEqual({ kind: 'phase', phase: 'listening' });
  });

  it('keeps the model’s private thinking out of what it says', async () => {
    readyCatalog();
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'Merhaba.' } });
    synthesizeInvoke.mockResolvedValue({
      ok: true,
      data: { audio: { dataBase64: pcm16ToWavBase64(pcmOf([1]), 24000), sampleRateHz: 24000 } },
    });

    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline } = await connect(
      events,
      () =>
        ({
          ok: true,
          body: thinkingSseBody(['Thinking', ' Process: ', 'the user greeted me.'], ['Merhaba!']),
        }) as unknown as Response
    );

    pipeline.pushAudio(toBase64(pcmOf([1])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settle();

    // The working-out reaches neither the speaker nor the caption strip: it is
    // in English, it is not addressed to anyone, and it is several times longer
    // than the answer.
    expect(synthesizeInvoke.mock.calls.map((call) => call[0].payload.text)).toEqual(['Merhaba!']);
    const said = events
      .filter((event) => event.kind === 'assistant-transcript')
      .map((event) => event.text)
      .join('');
    expect(said).not.toContain('Thinking');
    expect(events).toContainEqual({ kind: 'assistant-transcript', text: 'Merhaba!', final: true });
  });

  it('remembers the turn, so the next question has the last answer behind it', async () => {
    readyCatalog();
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'Adim ne?' } });
    synthesizeInvoke.mockResolvedValue({
      ok: true,
      data: { audio: { dataBase64: pcm16ToWavBase64(pcmOf([1]), 24000), sampleRateHz: 24000 } },
    });

    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline, fetchMock } = await connect(
      events,
      () => ({ ok: true, body: sseBody(['Serhan.']) }) as unknown as Response
    );

    pipeline.pushAudio(toBase64(pcmOf([1])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settle();
    pipeline.pushAudio(toBase64(pcmOf([1])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settle();

    const second = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'))[1];
    const messages = JSON.parse(String((second[1] as RequestInit).body)).messages;
    expect(messages[0].role).toBe('system');
    expect(messages.map((turn: { content: string }) => turn.content)).toContain('Serhan.');
  });

  it('drops the rest of a reply the user talked over', async () => {
    readyCatalog();
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'Anlat.' } });

    let speak: (() => void) | null = null;
    synthesizeInvoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          speak = () =>
            resolve({
              ok: true,
              data: { audio: { dataBase64: pcm16ToWavBase64(pcmOf([1]), 24000), sampleRateHz: 24000 } },
            });
        })
    );

    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline } = await connect(
      events,
      () => ({ ok: true, body: sseBody(['Bir. ', 'Iki. ', 'Uc.']) }) as unknown as Response
    );

    pipeline.pushAudio(toBase64(pcmOf([1])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settle();

    // Waiting on the first sentence; the user starts talking instead.
    pipeline.pushAudio(toBase64(pcmOf([2])), 'speech-started');
    speak?.();
    await settle();

    expect(events).toContainEqual({ kind: 'interrupted' });
    // The sentences behind the interrupted one are never rendered, and the
    // abandoned reply is not added to the history as though it were said.
    expect(synthesizeInvoke).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.kind === 'audio')).toBe(false);
    expect(events.some((event) => event.kind === 'assistant-transcript' && event.final)).toBe(false);
  });

  it('says nothing and goes back to listening when the room was not speech', async () => {
    readyCatalog();
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: '   ' } });

    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline, fetchMock } = await connect(
      events,
      () => ({ ok: true, body: sseBody(['unused']) }) as unknown as Response
    );

    pipeline.pushAudio(toBase64(pcmOf([1])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settle();

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/chat/completions'))).toBe(false);
    expect(synthesizeInvoke).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ kind: 'phase', phase: 'listening' });
  });

  it('reports a refusal from the local model rather than going quiet', async () => {
    readyCatalog();
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'Merhaba' } });

    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline } = await connect(events, () => ({ ok: false, body: null }) as unknown as Response);

    pipeline.pushAudio(toBase64(pcmOf([1])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settle();

    expect(events).toContainEqual({ kind: 'error', message: 'LOCAL_LLM_FAILED' });
    expect(events.at(-1)).toEqual({ kind: 'phase', phase: 'listening' });
  });

  it('ignores audio that arrives after the conversation was closed', async () => {
    readyCatalog();
    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline } = await connect(events, () => ({ ok: true, body: sseBody(['x']) }) as unknown as Response);

    pipeline.close();
    pipeline.pushAudio(toBase64(pcmOf([1])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settle();

    expect(transcribeInvoke).not.toHaveBeenCalled();
  });
});
