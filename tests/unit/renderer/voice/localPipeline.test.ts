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
  TURN_STALL_MS,
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

/**
 * The `messages` array of the last chat request that was sent.
 *
 * The cast is unavoidable — these are recorded `fetch` arguments — but the
 * lookup is not allowed to be: reading through an optional chain and then
 * dereferencing it turns "no request was made" into a TypeError several lines
 * from the assertion that cares.
 */
const lastRequestMessages = (calls: readonly unknown[][]): { content: string }[] => {
  const last = calls.at(-1);
  if (!last) throw new Error('no chat request was made');
  return JSON.parse(String((last[1] as RequestInit).body)).messages as { content: string }[];
};

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

  /**
   * The written reply and the spoken one are not the same text.
   *
   * The model narrates itself — "*calls app_ask_jester*", asides in brackets —
   * and this page read every word of it out loud, so the assistant announced the
   * name of the function it was about to call. On screen the sentence stays as
   * written; only what reaches the speaker is cleaned.
   */
  it('does not read the model narrating its own tool calls', async () => {
    readyCatalog();
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'Aç sunu.' } });
    synthesizeInvoke.mockImplementation(async () => ({
      ok: true,
      data: { audio: { dataBase64: pcm16ToWavBase64(pcmOf([1]), 22050), sampleRateHz: 22050 } },
    }));

    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline } = await connect(
      events,
      () =>
        ({
          ok: true,
          body: sseBody(['*calls app_ask_jester* ', 'Opening it now (one moment).']),
        }) as unknown as Response
    );

    pipeline.pushAudio(toBase64(pcmOf([1, 2])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settle();

    const spoken = synthesizeInvoke.mock.calls.map((call) => call[0].payload.text);
    expect(spoken).toEqual(['Opening it now.']);
    // Written out in full, though: the transcript is what was said, not what
    // was read aloud, and hiding it would make a wrong answer unexplainable.
    expect(events).toContainEqual({ kind: 'assistant-transcript', text: '*calls app_ask_jester* ', final: false });
  });

  it('falls back to a voice that can speak, not to a mute cloning engine', async () => {
    // Chatterbox and Qwen3 have no voice of their own: asked to speak with
    // nothing to imitate they refuse, so falling back to one is silence.
    const preset: VoiceModel = { ...TTS_MODEL, id: 'tts-piper-en-libritts-r', profileIds: ['libritts-p0'] };
    catalogInvoke.mockResolvedValue(okCatalog([STT_MODEL, TTS_MODEL, preset]));
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'Merhaba.' } });
    synthesizeInvoke.mockResolvedValue({
      ok: true,
      data: { audio: { dataBase64: pcm16ToWavBase64(pcmOf([1]), 24000), sampleRateHz: 24000 } },
    });

    const events: NormalizedRealtimeEvent[] = [];
    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith('/models')
        ? ({ ok: true, json: async () => ({ data: [{ id: 'm' }] }) } as unknown as Response)
        : ({ ok: true, body: sseBody(['Selam.']) } as unknown as Response)
    );
    vi.stubGlobal('fetch', fetchMock);

    const settings = settingsWith();
    // The configured voice was uninstalled since it was chosen.
    settings.tts.modelId = 'tts-a-voice-that-left';
    const pipeline = new LocalVoicePipeline({
      settings,
      interfaceLanguage: 'tr',
      onEvent: (event) => events.push(event),
    });
    await pipeline.connect();

    pipeline.pushAudio(toBase64(pcmOf([1])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settle();

    expect(synthesizeInvoke.mock.calls[0][0].payload).toMatchObject({
      modelId: 'tts-piper-en-libritts-r',
      providerId: 'local-audiocpp',
      // One of the fallback model's own voices, not a placeholder id. `speaker-0`
      // was tolerated by Piper and refused by Qwen3 with `500 requires speaker`,
      // which is the reply never being heard rather than a wrong accent.
      profileId: 'libritts-p0',
    });
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

  it('keeps the reply when the sound was too short to be someone talking', async () => {
    readyCatalog();
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'Anlat.' } });

    // Every outstanding render, not just the latest: the speaker keeps one
    // sentence in the engine while another plays, so a harness that remembers
    // only the last resolver leaves the one actually being awaited hanging.
    const waiting: ((value: unknown) => void)[] = [];
    synthesizeInvoke.mockImplementation(() => new Promise((resolve) => waiting.push(resolve)));
    const speak = (): void => {
      for (const resolve of waiting.splice(0)) {
        resolve({
          ok: true,
          data: { audio: { dataBase64: pcm16ToWavBase64(pcmOf([1]), 24000), sampleRateHz: 24000 } },
        });
      }
    };

    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline } = await connect(
      events,
      () => ({ ok: true, body: sseBody(['Bir. ', 'Iki. ', 'Uc.']) }) as unknown as Response
    );

    pipeline.pushAudio(toBase64(pcmOf([1])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settle();

    // Waiting on the first sentence when the room makes a noise — one sample,
    // far under the half-second bar. This used to abandon the answer outright:
    // the detector would not have opened a *turn* on it, and it still killed the
    // reply, so the user heard nothing and never learned why.
    pipeline.pushAudio(toBase64(pcmOf([2])), 'speech-started');
    speak();
    await settle();

    expect(events.some((event) => event.kind === 'interrupted')).toBe(false);
    expect(events.some((event) => event.kind === 'audio')).toBe(true);
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

describe('LocalVoicePipeline acting on the computer', () => {
  const readyCatalog = () => catalogInvoke.mockResolvedValue(okCatalog([STT_MODEL, TTS_MODEL]));

  /**
   * Settles a turn that goes through the model more than once.
   *
   * A tool round is a whole extra request, stream and synthesis, so the shallow
   * {@link settle} used elsewhere returns while the turn is still mid-round.
   */
  const settleRounds = async (): Promise<void> => {
    for (let turn = 0; turn < 200; turn += 1) await Promise.resolve();
  };

  /**
   * A conversation wired to a tool runner, with the model's replies scripted.
   *
   * `chats` is consumed one per pass through the model, which is what a tool
   * round is: the first pass asks for the tool, the second says the answer.
   */
  const connectWithTools = async (
    events: NormalizedRealtimeEvent[],
    chats: readonly (() => Response)[],
    runTool: (call: { callId: string; name: string; argumentsJson: string }) => Promise<unknown>
  ) => {
    let pass = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'google/gemma-4-e4b' }] }) } as unknown as Response;
      }
      const next = chats[Math.min(pass, chats.length - 1)];
      pass += 1;
      return next();
    });
    vi.stubGlobal('fetch', fetchMock);

    const pipeline = new LocalVoicePipeline({
      settings: settingsWith({ model: 'google/gemma-4-e4b' }),
      interfaceLanguage: 'tr',
      onEvent: (event) => events.push(event),
      runTool,
    });
    await pipeline.connect();
    return { pipeline, fetchMock };
  };

  const speakOnce = () =>
    synthesizeInvoke.mockResolvedValue({
      ok: true,
      data: { audio: { dataBase64: pcm16ToWavBase64(pcmOf([1]), 24000), sampleRateHz: 24000 } },
    });

  /**
   * A stream that asks for a tool, split the way a real one splits it.
   *
   * The id, the name and the arguments arrive in separate deltas, and the
   * arguments are a JSON document cut at an arbitrary character — verified
   * against LM Studio, which is why the pieces below do not line up with any
   * token boundary.
   */
  const toolSseBody = (name: string, argumentPieces: readonly string[]): ReadableStream<Uint8Array> => {
    const encoder = new TextEncoder();
    const frame = (delta: unknown) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n`;
    const lines = [
      frame({ tool_calls: [{ index: 0, id: 'call_abc', function: { name } }] }),
      ...argumentPieces.map((piece) => frame({ tool_calls: [{ index: 0, function: { arguments: piece } }] })),
      'data: [DONE]\n',
    ];
    return new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    });
  };

  it('offers the model no tools when nothing can run them', async () => {
    readyCatalog();
    speakOnce();
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'Merhaba.' } });

    const events: NormalizedRealtimeEvent[] = [];
    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith('/models')
        ? ({ ok: true, json: async () => ({ data: [{ id: 'm' }] }) } as unknown as Response)
        : ({ ok: true, body: sseBody(['Selam.']) } as unknown as Response)
    );
    vi.stubGlobal('fetch', fetchMock);

    const pipeline = new LocalVoicePipeline({
      settings: settingsWith({ model: 'm' }),
      interfaceLanguage: 'tr',
      onEvent: (event) => events.push(event),
    });
    await pipeline.connect();
    pipeline.pushAudio(toBase64(pcmOf([1])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settleRounds();

    // A server handed tools it will never be allowed to use spends the turn
    // describing what it would have done instead of answering.
    const chat = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/chat/completions'));
    expect(chat).toBeDefined();
    const body = JSON.parse(String((chat as unknown as [string, RequestInit])[1].body));
    expect(body.tools).toBeUndefined();
  });

  it('tells the model to look when the question is plainly about a screen', async () => {
    readyCatalog();
    speakOnce();
    // No mention of a screen anywhere in it. This is what people actually say,
    // and asked it the model used to answer from nothing.
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'Bu hata ne demek?' } });

    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline, fetchMock } = await connectWithTools(
      events,
      [() => ({ ok: true, body: sseBody(['Bir bakayim.']) }) as unknown as Response],
      vi.fn(async () => ({ ok: true }))
    );

    pipeline.pushAudio(toBase64(pcmOf([1])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settleRounds();

    const chat = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'))[0];
    const messages = JSON.parse(String((chat[1] as RequestInit).body)).messages as {
      role: string;
      content: string;
    }[];
    const nudge = messages.filter((turn) => turn.role === 'system').at(-1);
    expect(nudge?.content).toContain('app_look_at_screen');
  });

  it('leaves an ordinary question alone, so a screenshot is not taken for nothing', async () => {
    readyCatalog();
    speakOnce();
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'Bugun hava nasil?' } });

    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline, fetchMock } = await connectWithTools(
      events,
      [() => ({ ok: true, body: sseBody(['Bilmiyorum.']) }) as unknown as Response],
      vi.fn(async () => ({ ok: true }))
    );

    pipeline.pushAudio(toBase64(pcmOf([1])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settleRounds();

    const chat = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'))[0];
    const messages = JSON.parse(String((chat[1] as RequestInit).body)).messages as {
      role: string;
      content: string;
    }[];
    expect(messages.filter((turn) => turn.role === 'system')).toHaveLength(1);
  });

  it('runs the tool the model asked for and answers with what it learned', async () => {
    readyCatalog();
    speakOnce();
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'Ekranima bak.' } });

    const runTool = vi.fn(async () => ({ ok: true, screen: 'A code editor is open.' }));
    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline, fetchMock } = await connectWithTools(
      events,
      [
        () =>
          ({
            ok: true,
            body: toolSseBody('app_look_at_screen', ['{"question":', '"Ne var?"}']),
          }) as unknown as Response,
        () => ({ ok: true, body: sseBody(['Kod editoru acik.']) }) as unknown as Response,
      ],
      runTool
    );

    pipeline.pushAudio(toBase64(pcmOf([1])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settleRounds();

    // The arguments are reassembled across deltas before anything is run: acting
    // on half a JSON document is how a tool call silently does the wrong thing.
    expect(runTool).toHaveBeenCalledWith({
      callId: 'call_abc',
      name: 'app_look_at_screen',
      argumentsJson: '{"question":"Ne var?"}',
    });

    // The result goes back as a `tool` message addressed to the call, behind the
    // assistant turn that made it — a tool answer whose question is missing from
    // the history is rejected outright.
    const second = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'))[1];
    const messages = JSON.parse(String((second[1] as RequestInit).body)).messages as {
      role: string;
      content: string;
      tool_calls?: { id: string }[];
      tool_call_id?: string;
    }[];
    const asked = messages.find((turn) => turn.role === 'assistant' && turn.tool_calls);
    expect(asked?.tool_calls?.[0].id).toBe('call_abc');
    const answered = messages.find((turn) => turn.role === 'tool');
    expect(answered?.tool_call_id).toBe('call_abc');
    expect(answered?.content).toContain('A code editor is open.');

    // And the user hears the model's own sentence about it, not the raw result.
    expect(synthesizeInvoke.mock.calls.map((call) => call[0].payload.text)).toEqual(['Kod editoru acik.']);
    expect(events.at(-1)).toEqual({ kind: 'phase', phase: 'listening' });
  });

  it('says what went wrong when a tool fails, instead of going quiet', async () => {
    readyCatalog();
    speakOnce();
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'Discord ac.' } });

    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline, fetchMock } = await connectWithTools(
      events,
      [
        () => ({ ok: true, body: toolSseBody('app_ask_jester', ['{"request":"Discord"}']) }) as unknown as Response,
        () => ({ ok: true, body: sseBody(['Yapamadim.']) }) as unknown as Response,
      ],
      async () => {
        throw new Error('no agent is pinned');
      }
    );

    pipeline.pushAudio(toBase64(pcmOf([1])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settleRounds();

    // The failure becomes a result the model can talk about. Letting it throw
    // would end the turn with nothing said, which from the user's side is the
    // assistant having ignored them.
    const second = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'))[1];
    const messages = JSON.parse(String((second[1] as RequestInit).body)).messages as {
      role: string;
      content: string;
    }[];
    expect(messages.find((turn) => turn.role === 'tool')?.content).toContain('no agent is pinned');
    expect(synthesizeInvoke.mock.calls.map((call) => call[0].payload.text)).toEqual(['Yapamadim.']);
  });

  it('stops asking for tools rather than looping without ever speaking', async () => {
    readyCatalog();
    speakOnce();
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'Bak.' } });

    const runTool = vi.fn(async () => ({ ok: true }));
    const events: NormalizedRealtimeEvent[] = [];
    // A model that answers every round with another tool call. The user cannot
    // interrupt a conversation that never makes a sound, so the round count is
    // what ends it.
    const { pipeline } = await connectWithTools(
      events,
      [() => ({ ok: true, body: toolSseBody('app_look_at_screen', ['{}']) }) as unknown as Response],
      runTool
    );

    pipeline.pushAudio(toBase64(pcmOf([1])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settleRounds();

    expect(runTool.mock.calls.length).toBeLessThanOrEqual(4);
    expect(events.at(-1)).toEqual({ kind: 'phase', phase: 'listening' });
  });
});

/**
 * Being interrupted, and surviving it.
 *
 * The reported symptom was "even when it hears me it doesn't reply, and I can't
 * see what I said". The cause was an asymmetry: the detector refuses to *open* a
 * turn on less than `minimumSpeechMs` because "anything shorter was a cough, a
 * door, or a keystroke" — but cancelling a reply took a single frame. So the same
 * cough that could not ask a question destroyed the answer, before a word of it
 * was spoken and before the transcript existed to show.
 */
/**
 * What may and may not cut a reply short.
 *
 * The reported symptom was "even when it hears me it doesn't reply, and I can't
 * see what I said". The cause was that cancelling a reply took one loud frame,
 * while the detector refuses to *open* a turn on less than `minimumSpeechMs`
 * because "anything shorter was a cough, a door, or a keystroke". So the same
 * cough that could not ask a question destroyed the answer — before a word of it
 * was spoken, and before there was a transcript to show.
 *
 * Guessing from the audio was the mistake. A level cannot tell a chair from a
 * sentence, so now exactly one thing stops a reply: a word the user chooses.
 */
describe('LocalVoicePipeline while it is talking', () => {
  const readyCatalog = () => catalogInvoke.mockResolvedValue(okCatalog([STT_MODEL, TTS_MODEL]));

  const settleLong = async (): Promise<void> => {
    for (let turn = 0; turn < 80; turn += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  };

  /**
   * A conversation whose sentences are only spoken when the test says so.
   *
   * Every state worth testing exists *while* a reply is being said, and a
   * synthesiser that resolves immediately skips straight through them.
   */
  const start = async (
    events: NormalizedRealtimeEvent[],
    reply: readonly string[],
    playback: Record<string, unknown> = {}
  ) => {
    const waiting: ((value: unknown) => void)[] = [];
    synthesizeInvoke.mockImplementation(() => new Promise((resolve) => waiting.push(resolve)));
    /** Lets the sentence at the speaker finish rendering. */
    const speakNext = () =>
      waiting.shift()?.({
        ok: true,
        data: { audio: { dataBase64: pcm16ToWavBase64(pcmOf([1]), 24000), sampleRateHz: 24000 } },
      });

    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith('/models')
        ? ({ ok: true, json: async () => ({ data: [{ id: 'm' }] }) } as unknown as Response)
        : ({ ok: true, body: sseBody(reply) } as unknown as Response)
    );
    vi.stubGlobal('fetch', fetchMock);

    const settings = settingsWith({ model: 'm' });
    settings.playback = { ...settings.playback, interruptPhrase: 'dur', ...playback };
    const pipeline = new LocalVoicePipeline({
      settings,
      interfaceLanguage: 'tr',
      onEvent: (event) => events.push(event),
    });
    await pipeline.connect();
    return { pipeline, fetchMock, speakNext };
  };

  /** Asks something and gets as far as the first sentence being at the speaker. */
  const ask = async (pipeline: InstanceType<typeof LocalVoicePipeline>, text = 'Anlat bana.') => {
    transcribeInvoke.mockResolvedValueOnce({ ok: true, data: { text } });
    pipeline.pushAudio(toBase64(pcmOf([1, 2, 3])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settleLong();
  };

  /** Something said while it is still talking. */
  const interject = async (pipeline: InstanceType<typeof LocalVoicePipeline>, text: string) => {
    transcribeInvoke.mockResolvedValueOnce({ ok: true, data: { text } });
    pipeline.pushAudio(toBase64(pcmOf([4, 5, 6])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settleLong();
  };

  it('stops when it hears the word, and says nothing more', async () => {
    readyCatalog();
    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline } = await start(events, ['Bir. ', 'Iki. ', 'Uc.']);
    await ask(pipeline);

    const renderedBefore = synthesizeInvoke.mock.calls.length;
    await interject(pipeline, 'dur');

    expect(events).toContainEqual({ kind: 'interrupted' });
    expect(events).toContainEqual({ kind: 'user-transcript', text: 'dur', final: true });
    expect(events.at(-1)).toEqual({ kind: 'phase', phase: 'listening' });
    // Nothing behind the sentence it was cut off in is rendered.
    expect(synthesizeInvoke.mock.calls.length).toBe(renderedBefore);
  });

  it('answers what came after the word in the same breath', async () => {
    readyCatalog();
    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline, fetchMock } = await start(events, ['Bir. ', 'Iki. ']);
    await ask(pipeline);

    await interject(pipeline, 'dur bunun yerine hava nasil');

    const chats = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'));
    expect(chats.length).toBeGreaterThanOrEqual(2);
    const messages = lastRequestMessages(chats);
    expect(messages.map((turn) => turn.content)).toContain('bunun yerine hava nasil');
  });

  it('is not stopped by a word that merely starts the same way', async () => {
    readyCatalog();
    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline } = await start(events, ['Bir. ', 'Iki. ']);
    await ask(pipeline);

    // A single-word phrase has to be heard exactly — `durum` is not `dur`.
    await interject(pipeline, 'durum ne');

    expect(events.some((event) => event.kind === 'interrupted')).toBe(false);
  });

  it('is not stopped by someone showing they are still listening', async () => {
    readyCatalog();
    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline } = await start(events, ['Bir. ', 'Iki. ']);
    await ask(pipeline);

    await interject(pipeline, 'hihi');
    await interject(pipeline, 'evet anladim');

    expect(events.some((event) => event.kind === 'interrupted')).toBe(false);
    // Shown, though, so it is visible that it was heard.
    expect(events).toContainEqual({ kind: 'user-transcript', text: 'evet anladim', final: true });
  });

  it('lets another question wait rather than throwing the answer away', async () => {
    readyCatalog();
    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline, fetchMock, speakNext } = await start(events, ['Bir.']);
    await ask(pipeline);

    await interject(pipeline, 'hava nasil');
    // Still talking: the question did not cut in.
    expect(events.some((event) => event.kind === 'interrupted')).toBe(false);

    // Once the reply is finished, the question it heard is answered.
    speakNext();
    await settleLong();
    speakNext();
    await settleLong();

    const chats = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'));
    const messages = lastRequestMessages(chats);
    expect(messages.map((turn) => turn.content)).toContain('hava nasil');
  });

  it('cannot be stopped at all when the word is switched off', async () => {
    readyCatalog();
    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline } = await start(events, ['Bir. ', 'Iki. '], { interruptible: false });
    await ask(pipeline);

    await interject(pipeline, 'dur');

    expect(events.some((event) => event.kind === 'interrupted')).toBe(false);
  });

  it('says so when it heard a sound but no words', async () => {
    readyCatalog();
    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline } = await start(events, ['Bir.']);

    transcribeInvoke.mockResolvedValueOnce({ ok: true, data: { text: '   ' } });
    pipeline.pushAudio(toBase64(pcmOf([1, 2])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
    await settleLong();

    // Silence here is indistinguishable from the app being broken, which is
    // precisely how this was reported.
    expect(events).toContainEqual({ kind: 'error', message: 'LOCAL_HEARD_NOTHING' });
  });

  /**
   * The next sentence is rendered while the current one is playing.
   *
   * Rendering used to be strictly sequential — synthesise, hand over,
   * synthesise the next — and since handing over is instant, the gap between
   * sentences was the full cost of synthesising one. Inaudible with a fast
   * engine; with Qwen3 on a graphics card it is most of a second each, plus the
   * twenty the first requests spend building CUDA graphs. Reported as "it says
   * the first sentence and then takes forever, while I can already read the
   * rest".
   */
  it('renders the next sentence while the current one is still at the speaker', async () => {
    readyCatalog();
    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline, speakNext } = await start(events, ['Bir. ', 'Iki. ', 'Uc.']);
    await ask(pipeline);

    // Nothing has been handed to the speaker yet — the first render is still
    // outstanding — and the second is already in the engine.
    expect(synthesizeInvoke.mock.calls.length).toBe(2);

    // Order is still the order it was written in: the first to resolve is the
    // first to be spoken.
    speakNext();
    await settleLong();
    const spoken = synthesizeInvoke.mock.calls.map((call) => call[0].payload.text);
    expect(spoken.slice(0, 2)).toEqual(['Bir.', 'Iki.']);
  });

  it('does not run the whole reply through the engine at once', async () => {
    readyCatalog();
    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline } = await start(events, ['Bir. ', 'Iki. ', 'Uc. ', 'Dort. ', 'Bes.']);
    await ask(pipeline);

    // A barge-in throws away whatever was rendered ahead, so rendering ahead is
    // worth exactly one sentence of cover and no more.
    expect(synthesizeInvoke.mock.calls.length).toBeLessThanOrEqual(2);
  });

  /**
   * Something to hear while a long task runs — but only into an actual silence.
   *
   * A task handed to the agent takes minutes, and for all of them the user heard
   * nothing. Silence from something that was talking a moment ago reads as a
   * crash, so they ask again and the same job runs twice. An aside spoken over
   * an answer, though, is worse than the silence it was meant to fill.
   */
  it('says an aside when nothing else is being said', async () => {
    readyCatalog();
    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline, speakNext } = await start(events, ['Bir.']);

    const spoken = pipeline.speakAside('Hala uzerinde calisiyorum.');
    await settleLong();
    speakNext();
    await spoken;

    expect(synthesizeInvoke.mock.calls.map((call) => call[0].payload.text)).toContain('Hala uzerinde calisiyorum.');
  });

  it('stays quiet while a turn is in flight', async () => {
    readyCatalog();
    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline } = await start(events, ['Bir. ', 'Iki.']);
    await ask(pipeline);

    const before = synthesizeInvoke.mock.calls.length;
    await pipeline.speakAside('Hala uzerinde calisiyorum.');

    expect(synthesizeInvoke.mock.calls.length).toBe(before);
  });

  it('adds nothing to the conversation, since it is the app talking and not the assistant', async () => {
    readyCatalog();
    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline, speakNext } = await start(events, ['Bir.']);

    const spoken = pipeline.speakAside('Hala uzerinde calisiyorum.');
    await settleLong();
    speakNext();
    await spoken;

    // No transcript for it: the user did not say it and the assistant did not
    // answer it, so it belongs in neither side of the conversation.
    expect(events.some((event) => event.kind === 'assistant-transcript')).toBe(false);
  });
});

/**
 * Speaking while it is still talking.
 *
 * The reported failure: after a few commands, whatever the user says vanishes
 * and the assistant stops answering. The cause is here rather than anywhere
 * dramatic — a question asked mid-reply went into a single slot, was never shown
 * on screen, was overwritten by the next one, and was thrown away entirely if
 * anything interrupted the reply it was waiting behind.
 *
 * From the user's side that is indistinguishable from the app freezing: they
 * talk, nothing appears, nothing happens, and the more commands they give the
 * more certain it is to happen.
 */
describe('a question asked while the assistant is still talking', () => {
  const readyCatalog = () => catalogInvoke.mockResolvedValue(okCatalog([STT_MODEL, TTS_MODEL]));

  const speaks = () =>
    synthesizeInvoke.mockImplementation(async () => ({
      ok: true,
      data: { audio: { dataBase64: pcm16ToWavBase64(pcmOf([1]), 22050), sampleRateHz: 22050 } },
    }));

  /**
   * A pipeline whose first reply can be held open.
   *
   * The condition under test only exists while a turn is in flight, so the chat
   * response for the first turn is a promise this test releases by hand. Without
   * that the first turn finishes during `settle()` and every later utterance
   * takes the ordinary path — which is how the first version of these tests
   * passed against the very bug they were written for.
   */
  const openHeld = async (events: NormalizedRealtimeEvent[], sent: string[]) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let turn = 0;

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'google/gemma-4-e4b' }] }) } as unknown as Response;
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: string }[] };
      const last = body.messages?.filter((message) => message.role === 'user').at(-1);
      if (last) sent.push(last.content);

      // Only the first turn is held; the rest answer at once so the queue can
      // be seen draining.
      if (++turn === 1) await held;
      return { ok: true, body: sseBody(['Tamam. ']) } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const pipeline = new LocalVoicePipeline({
      settings: settingsWith({ model: 'google/gemma-4-e4b' }),
      interfaceLanguage: 'tr',
      onEvent: (event) => events.push(event),
    });
    await pipeline.connect();
    return { pipeline, release };
  };

  /** One utterance, end to end, as the detector delivers it. */
  const say = (pipeline: LocalVoicePipeline, sample: number): void => {
    pipeline.pushAudio(toBase64(pcmOf([sample])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
  };

  const drain = async (): Promise<void> => {
    for (let round = 0; round < 12; round += 1) await settle();
  };

  it('shows what it heard, even when it cannot answer yet', async () => {
    readyCatalog();
    speaks();
    let spoken = 0;
    transcribeInvoke.mockImplementation(async () => ({ ok: true, data: { text: `soru ${++spoken}` } }));

    const events: NormalizedRealtimeEvent[] = [];
    const { pipeline, release } = await openHeld(events, []);

    say(pipeline, 1);
    await settle();
    events.length = 0;

    // Spoken over the reply, which is still being written. It has to appear:
    // silence here is the whole bug.
    say(pipeline, 2);
    await drain();

    expect(events.filter((event) => event.kind === 'user-transcript')).not.toHaveLength(0);
    release();
    await drain();
  });

  it('keeps every question, not only the last one', async () => {
    readyCatalog();
    speaks();
    let spoken = 0;
    transcribeInvoke.mockImplementation(async () => ({ ok: true, data: { text: `soru ${++spoken}` } }));

    const events: NormalizedRealtimeEvent[] = [];
    const sent: string[] = [];
    const { pipeline, release } = await openHeld(events, sent);

    say(pipeline, 1);
    await settle();

    // Two more while the first is still being answered.
    say(pipeline, 2);
    await settle();
    say(pipeline, 3);
    await settle();

    release();
    await drain();

    // Dropping the middle question is the failure the user actually saw.
    expect(sent).toEqual(['soru 1', 'soru 2', 'soru 3']);
  });

  /**
   * Interrupting the *reply* is not cancelling the *questions*. The talk key and
   * the interrupt button both abort the turn in flight, and the queue behind it
   * used to go with it.
   */
  it('still answers what was waiting after the reply is cut short', async () => {
    readyCatalog();
    speaks();
    let spoken = 0;
    transcribeInvoke.mockImplementation(async () => ({ ok: true, data: { text: `soru ${++spoken}` } }));

    const events: NormalizedRealtimeEvent[] = [];
    const sent: string[] = [];
    const { pipeline, release } = await openHeld(events, sent);

    say(pipeline, 1);
    await settle();
    say(pipeline, 2);
    await settle();

    // The user reaches for the talk key while it is still speaking.
    pipeline.interrupt();
    release();
    await drain();

    expect(sent).toContain('soru 2');
  });
});

/**
 * A turn that never ends.
 *
 * The reported failure was not that one answer went missing — it was that after
 * a few commands the assistant stopped answering *at all*: what was said
 * appeared on screen, disappeared, and the job was never done.
 *
 * That is what an unbounded turn looks like from the outside. Nothing bounded
 * how long a reply could take: the chat request carried no timeout, a stalled
 * stream left `reader.read()` waiting forever, and the wait for the speaker had
 * no ceiling either. One stall and `inFlight` stayed set for the rest of the
 * session, so every later question took the "something is already being said"
 * path — shown once, then replaced by the next one, and answered never.
 *
 * A turn has to end. This pins that it does.
 */
describe('a turn that stalls', () => {
  const readyCatalog = () => catalogInvoke.mockResolvedValue(okCatalog([STT_MODEL, TTS_MODEL]));

  const speaks = () =>
    synthesizeInvoke.mockImplementation(async () => ({
      ok: true,
      data: { audio: { dataBase64: pcm16ToWavBase64(pcmOf([1]), 22050), sampleRateHz: 22050 } },
    }));

  /** A pipeline whose first reply never arrives, the way a hung server behaves. */
  const openStalled = async (events: NormalizedRealtimeEvent[], sent: string[]) => {
    let turn = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'google/gemma-4-e4b' }] }) } as unknown as Response;
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: string }[] };
      const last = body.messages?.filter((message) => message.role === 'user').at(-1);
      if (last) sent.push(last.content);

      // The first request never settles — no response, no error, no timeout of
      // its own. Exactly what a wedged local server does.
      if (++turn === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      }
      return { ok: true, body: sseBody(['Tamam. ']) } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const pipeline = new LocalVoicePipeline({
      settings: settingsWith({ model: 'google/gemma-4-e4b' }),
      interfaceLanguage: 'tr',
      onEvent: (event) => events.push(event),
    });
    await pipeline.connect();
    return pipeline;
  };

  const say = (pipeline: LocalVoicePipeline, sample: number): void => {
    pipeline.pushAudio(toBase64(pcmOf([sample])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
  };

  const drain = async (): Promise<void> => {
    for (let round = 0; round < 12; round += 1) await settle();
  };

  it('gives up on it, so the next thing asked is still answered', async () => {
    vi.useFakeTimers();
    try {
      readyCatalog();
      speaks();
      let spoken = 0;
      transcribeInvoke.mockImplementation(async () => ({ ok: true, data: { text: `soru ${++spoken}` } }));

      const events: NormalizedRealtimeEvent[] = [];
      const sent: string[] = [];
      const pipeline = await openStalled(events, sent);

      say(pipeline, 1);
      await drain();

      // Long enough that any honest reply would have started by now.
      await vi.advanceTimersByTimeAsync(TURN_STALL_MS + 1000);
      await drain();

      say(pipeline, 2);
      await drain();

      // The second question is the whole point: a session is not over because
      // one reply hung.
      expect(sent).toContain('soru 2');
      expect(events.some((event) => event.kind === 'phase' && event.phase === 'listening')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says that it gave up rather than going quiet', async () => {
    vi.useFakeTimers();
    try {
      readyCatalog();
      speaks();
      transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'tarayıcıyı aç' } });

      const events: NormalizedRealtimeEvent[] = [];
      const pipeline = await openStalled(events, []);

      say(pipeline, 1);
      await drain();
      await vi.advanceTimersByTimeAsync(TURN_STALL_MS + 1000);
      await drain();

      // Silence is what made this look like a freeze. Something has to be said.
      expect(events.some((event) => event.kind === 'error')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * A stall while the speaker is mid-sentence.
 *
 * The nastier shape of the same failure. Abandoning the turn is not enough on
 * its own: the loop that speaks the queue is guarded by a flag, and that flag is
 * only lowered when the loop finishes. A loop waiting on a synthesis request
 * that never returns keeps the flag raised, and the *next* answer then arrives
 * as text with no voice — which reads as the assistant having gone mute rather
 * than as anything having gone wrong.
 *
 * So the watchdog reclaims the speaker too, and the abandoned loop is not
 * allowed to tidy up state that has since been handed to someone else.
 */
describe('a stall while it is speaking', () => {
  const readyCatalog = () => catalogInvoke.mockResolvedValue(okCatalog([STT_MODEL, TTS_MODEL]));

  const say = (pipeline: LocalVoicePipeline, sample: number): void => {
    pipeline.pushAudio(toBase64(pcmOf([sample])), 'speech-started');
    pipeline.pushAudio('', 'utterance-ended');
  };

  const drain = async (): Promise<void> => {
    for (let round = 0; round < 12; round += 1) await settle();
  };

  it('still speaks the next answer, even though the last one never finished saying', async () => {
    vi.useFakeTimers();
    try {
      readyCatalog();
      let spoken = 0;
      transcribeInvoke.mockImplementation(async () => ({ ok: true, data: { text: `soru ${++spoken}` } }));

      // The first synthesis request never returns. The second and later ones do.
      let renders = 0;
      synthesizeInvoke.mockImplementation(async () => {
        if (++renders === 1) return new Promise(() => undefined);
        return {
          ok: true,
          data: { audio: { dataBase64: pcm16ToWavBase64(pcmOf([1]), 22050), sampleRateHz: 22050 } },
        };
      });

      const events: NormalizedRealtimeEvent[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (String(url).endsWith('/models')) {
            return { ok: true, json: async () => ({ data: [{ id: 'google/gemma-4-e4b' }] }) } as unknown as Response;
          }
          return { ok: true, body: sseBody(['Tamam. ']) } as unknown as Response;
        })
      );

      const pipeline = new LocalVoicePipeline({
        settings: settingsWith({ model: 'google/gemma-4-e4b' }),
        interfaceLanguage: 'tr',
        onEvent: (event) => events.push(event),
      });
      await pipeline.connect();

      say(pipeline, 1);
      await drain();
      await vi.advanceTimersByTimeAsync(TURN_STALL_MS + 1000);
      await drain();

      events.length = 0;
      say(pipeline, 2);
      await drain();
      await vi.advanceTimersByTimeAsync(1000);
      await drain();

      // Text without voice is the failure being pinned here.
      expect(events.some((event) => event.kind === 'audio')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
