/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedRealtimeEvent } from '@/common/realtime';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings, type VoiceModel } from '@/common/types/foolVoice';

const taughtSkills: { id: string; name: string; when: string; action: { kind: 'open-url'; url: string } }[] = [];

vi.mock('@renderer/services/voice/session/localSkillStore', () => ({
  peekLocalSkills: () => taughtSkills,
}));

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
    // Opening a spoken session asks who the assistants are and which providers
    // exist, so it can name the one that answers. Nothing below turns on the
    // answer — but a bridge missing the channel throws on the way in, and every
    // test in this file fails before it has begun.
    assistants: { list: { invoke: () => Promise.resolve([]) } },
    mode: { listProviders: { invoke: () => Promise.resolve([]) } },
  },
}));

const {
  LocalVoicePipeline,
  SILENT_REPLY_MS,
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

  /**
   * "Switch to the bigger model" used to be agreed to and then ignored.
   *
   * The model was resolved once, at connect, and frozen for the length of the
   * conversation — so the setting was written, confirmed out loud, and every
   * later turn still went to whatever had been loaded when it opened. From
   * where the user sits that is the assistant saying yes and doing nothing.
   */
  describe('the model that answers the next turn', () => {
    const connectWithTwo = async (events: NormalizedRealtimeEvent[]) => {
      const fetchMock = vi.fn(async (url: string) =>
        String(url).endsWith('/models')
          ? ({
              ok: true,
              json: async () => ({ data: [{ id: 'google/gemma-4-e4b' }, { id: 'qwen/qwen3.5-9b' }] }),
            } as unknown as Response)
          : ({ ok: true, body: sseBody(['Tamam.']) } as unknown as Response)
      );
      vi.stubGlobal('fetch', fetchMock);

      const pipeline = new LocalVoicePipeline({
        settings: settingsWith({ model: 'google/gemma-4-e4b' }),
        interfaceLanguage: 'tr',
        onEvent: (event) => events.push(event),
      });
      await pipeline.connect();
      return { pipeline, fetchMock };
    };

    const modelOfLastTurn = (fetchMock: ReturnType<typeof vi.fn>): string => {
      const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'));
      const last = calls.at(-1)?.[1] as { body: string };
      return (JSON.parse(last.body) as { model: string }).model;
    };

    const sayOneThing = async (pipeline: { pushAudio: (audio: string, event: string) => void }): Promise<void> => {
      pipeline.pushAudio(toBase64(pcmOf([1])), 'speech-started');
      pipeline.pushAudio('', 'utterance-ended');
      await settle();
    };

    beforeEach(() => {
      readyCatalog();
      transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'Merhaba.' } });
      synthesizeInvoke.mockResolvedValue({
        ok: true,
        data: { audio: { dataBase64: pcm16ToWavBase64(pcmOf([1]), 24000), sampleRateHz: 24000 } },
      });
    });

    it('follows a model chosen while the conversation is open', async () => {
      const events: NormalizedRealtimeEvent[] = [];
      const { pipeline, fetchMock } = await connectWithTwo(events);

      await sayOneThing(pipeline);
      expect(modelOfLastTurn(fetchMock)).toBe('google/gemma-4-e4b');

      pipeline.updateSettings(settingsWith({ model: 'qwen/qwen3.5-9b' }));
      await sayOneThing(pipeline);
      expect(modelOfLastTurn(fetchMock)).toBe('qwen/qwen3.5-9b');
    });

    /// A stale id in the settings should not be the reason every turn from
    /// then on fails — the same rule connect applies when it first resolves.
    it('falls back to what is loaded when the chosen model is not there', async () => {
      const events: NormalizedRealtimeEvent[] = [];
      const { pipeline, fetchMock } = await connectWithTwo(events);

      pipeline.updateSettings(settingsWith({ model: 'a-model-nobody-has' }));
      await sayOneThing(pipeline);

      expect(modelOfLastTurn(fetchMock)).toBe('google/gemma-4-e4b');
    });
  });

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
    // That the turn ended, rather than which phase happens to be last: the
    // admission below is spoken after the loop returns, so the final phase is
    // now whatever the speaker is doing, and asserting on it would be a test of
    // drain timing rather than of the round bound.
    expect(events).toContainEqual({ kind: 'phase', phase: 'listening' });

    // And it does not go quiet. A turn that ran four tools and never made a
    // sound is indistinguishable from not having been heard — but what it says
    // is the admission, not "Done.": it exhausted its rounds, so it finished
    // nothing that was asked for, and confirming here would be a false claim
    // arriving through the door built to prevent silence.
    expect(synthesizeInvoke.mock.calls.map((call) => call[0].payload.text)).toEqual(['I could not do that.']);
  });

  /**
   * The two failures the user actually reported, pinned against the real
   * pipeline rather than against the detector on its own.
   *
   * Both were watched happening in the app: a song that never played while the
   * assistant said it was playing. A unit test of the matcher would not have
   * caught either, because in both cases the matcher was right and the wiring
   * around it was what decided the outcome.
   */
  describe('doing the thing, or not claiming to', () => {
    beforeEach(() => {
      taughtSkills.length = 0;
    });

    /**
     * The shortcut this used to assert is gone, and its removal is the fix.
     *
     * A taught skill was matched on the words of the sentence and run before
     * the model saw the turn. So "favori şarkımı hatırlıyor musun" played the
     * song: the trigger appeared in the sentence, the shortcut fired, and the
     * question went unanswered. Guarding the matcher against questions was the
     * first attempt and it was the wrong shape — a phrase list deciding intent
     * is always wrong about the sentence nobody thought of.
     *
     * The skills are described to the model and `app_skill_do` is a tool it can
     * call, so the decision belongs to the thing that can read the sentence.
     * The round trip is the price of judgement.
     */
    it('asks the model rather than matching the words itself', async () => {
      readyCatalog();
      speakOnce();
      transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'favori sarkimi ac' } });
      taughtSkills.push({
        id: 'favori sarkim',
        name: 'Favori sarkim',
        when: 'favori sarkimi ac',
        action: { kind: 'open-url', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      });

      const events: NormalizedRealtimeEvent[] = [];
      const ran: string[] = [];
      const { pipeline, fetchMock } = await connectWithTools(
        events,
        [() => ({ ok: true, body: sseBody(['Bir seyler soyluyorum.']) }) as unknown as Response],
        async (call) => {
          ran.push(call.name);
          return { ok: true };
        }
      );

      const before = fetchMock.mock.calls.length;
      pipeline.pushAudio(toBase64(pcmOf([1, 2])), 'speech-started');
      pipeline.pushAudio('', 'utterance-ended');
      await settle();

      // Nothing ran behind the model's back...
      expect(ran).toEqual([]);
      // ...and the turn reached it, which is where the decision now belongs.
      expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    });

    it('leaves a history the server will still accept on the next turn', async () => {
      readyCatalog();
      speakOnce();
      transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'favori sarkimi ac' } });
      taughtSkills.push({
        id: 'favori sarkim',
        name: 'Favori sarkim',
        when: 'favori sarkimi ac',
        action: { kind: 'open-url', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      });

      const events: NormalizedRealtimeEvent[] = [];
      const { pipeline, fetchMock } = await connectWithTools(
        events,
        [() => ({ ok: true, body: sseBody(['Tabii.']) }) as unknown as Response],
        async () => ({ ok: true })
      );

      // The skill turn, then an ordinary one after it.
      pipeline.pushAudio(toBase64(pcmOf([1, 2])), 'speech-started');
      pipeline.pushAudio('', 'utterance-ended');
      await settle();
      transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'saat kac' } });
      pipeline.pushAudio(toBase64(pcmOf([3, 4])), 'speech-started');
      pipeline.pushAudio('', 'utterance-ended');
      await settle();

      // Every `tool` message must answer a `tool_calls` that is actually in the
      // history. A server handed an orphan rejects the whole request, which ran
      // the skill once and then broke every turn after it — a conversation that
      // does the thing and then stops responding.
      const chat = fetchMock.mock.calls.find((call) => !String(call[0]).endsWith('/models') && call[1]);
      const sent = JSON.parse((chat![1] as { body: string }).body).messages as {
        role: string;
        tool_call_id?: string;
        tool_calls?: { id: string }[];
      }[];
      const offered = new Set(sent.flatMap((message) => (message.tool_calls ?? []).map((c) => c.id)));
      const answered = sent.filter((message) => message.role === 'tool').map((message) => message.tool_call_id);
      // Every `tool` message must answer a `tool_calls` that is in the history.
      // There may now be none at all — the skill shortcut that used to write one
      // is gone — and an empty history is trivially consistent. What must never
      // appear is an answer to a call nobody made.
      expect(answered.filter((id) => !offered.has(id!))).toEqual([]);
    });

    it('never speaks a claim that something happened when nothing ran', async () => {
      readyCatalog();
      speakOnce();
      transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'sarkiyi ac' } });

      const events: NormalizedRealtimeEvent[] = [];
      await connectWithTools(
        events,
        [
          // The exact sentence, with no tool call behind it.
          () => ({ ok: true, body: sseBody(['Simdi caliyor.']) }) as unknown as Response,
          // What it says once it has been handed its own sentence back.
          () => ({ ok: true, body: sseBody(['Kusura bakma, henuz acmadim.']) }) as unknown as Response,
        ],
        async () => ({ ok: true })
      ).then(({ pipeline }) => {
        pipeline.pushAudio(toBase64(pcmOf([1, 2])), 'speech-started');
        pipeline.pushAudio('', 'utterance-ended');
      });
      await settle();

      const spoken = synthesizeInvoke.mock.calls.map((call) => call[0].payload.text as string);
      // The lie reached neither the speaker nor the screen.
      expect(spoken.some((line) => line.includes('Simdi caliyor'))).toBe(false);
      // On screen, the refused text is retracted rather than left sitting
      // there: the partial reply is published as it streams, so by the time a
      // sentence can be judged the user is already reading it.
      const said = events
        .filter((event) => event.kind === 'assistant-transcript')
        .map((event) => (event as { text: string }).text);
      const lastFinal = events
        .filter((event) => event.kind === 'assistant-transcript' && (event as { final?: boolean }).final)
        .at(-1) as { text: string } | undefined;
      expect(said.some((line) => line.includes('Simdi caliyor'))).toBe(true);
      expect(lastFinal?.text ?? '').not.toContain('Simdi caliyor');
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

  /**
   * Changing the voice while the conversation is open.
   *
   * The reported failure: "switch to a male voice" is accepted, the setting is
   * written, and the next sentence comes back in the old voice anyway — it only
   * takes effect after the conversation is restarted. The pipeline took a copy of
   * the settings when it was built and never looked again, so every request it
   * made for the rest of the session named the voice that was current when the
   * session started.
   *
   * It matters beyond the voice: speed, volume and the reply language are all
   * changed the same way and were all equally stuck.
   */
  describe('a setting changed while the conversation is open', () => {
    const readyCatalog = () => catalogInvoke.mockResolvedValue(okCatalog([STT_MODEL, TTS_MODEL]));

    const speaks = () =>
      synthesizeInvoke.mockImplementation(async () => ({
        ok: true,
        data: { audio: { dataBase64: pcm16ToWavBase64(pcmOf([1]), 22050), sampleRateHz: 22050 } },
      }));

    const openWith = async (events: NormalizedRealtimeEvent[]) => {
      const fetchMock = vi.fn(async (url: string) => {
        if (String(url).endsWith('/models')) {
          return { ok: true, json: async () => ({ data: [{ id: 'google/gemma-4-e4b' }] }) } as unknown as Response;
        }
        return { ok: true, body: sseBody(['Tamam. ']) } as unknown as Response;
      });
      vi.stubGlobal('fetch', fetchMock);

      const pipeline = new LocalVoicePipeline({
        settings: settingsWith({ model: 'google/gemma-4-e4b' }),
        interfaceLanguage: 'tr',
        onEvent: (event: NormalizedRealtimeEvent) => void events.push(event),
      });
      await pipeline.connect();
      return pipeline;
    };

    const speak = async (pipeline: LocalVoicePipeline, text: string) => {
      transcribeInvoke.mockResolvedValue({ ok: true, data: { text } });
      pipeline.pushAudio(toBase64(pcmOf([1, 2])), 'speech-started');
      pipeline.pushAudio(toBase64(pcmOf([1, 2])), 'utterance-ended');
      await settle();
    };

    it('uses the voice that is current now, not the one it started with', async () => {
      readyCatalog();
      speaks();
      const events: NormalizedRealtimeEvent[] = [];
      const pipeline = await openWith(events);

      await speak(pipeline, 'merhaba');
      const before = synthesizeInvoke.mock.calls.at(-1)?.[0].payload.profileId;
      expect(before).toBe('cloned:jarvis');

      // What "switch to a male voice" amounts to: the stored settings change.
      pipeline.updateSettings({
        ...settingsWith({ model: 'google/gemma-4-e4b' }),
        tts: { ...settingsWith().tts, modelId: TTS_MODEL.id, profileId: 'piper:male' },
      });

      await speak(pipeline, 'tekrar söyle');
      expect(synthesizeInvoke.mock.calls.at(-1)?.[0].payload.profileId).toBe('piper:male');

      pipeline.close();
    });

    it('carries the speed with it, because the same instruction changes that too', async () => {
      readyCatalog();
      speaks();
      const events: NormalizedRealtimeEvent[] = [];
      const pipeline = await openWith(events);

      const next = settingsWith({ model: 'google/gemma-4-e4b' });
      pipeline.updateSettings({ ...next, tts: { ...next.tts, speed: 1.4 } });

      await speak(pipeline, 'merhaba');
      expect(synthesizeInvoke.mock.calls.at(-1)?.[0].payload.speed).toBe(1.4);

      pipeline.close();
    });
  });

  /**
   * A model that thinks and never speaks.
   *
   * The watchdog above bounds a *connection* that has gone dead: nothing arriving
   * for forty-five seconds ends the turn. It does not bound a *reply*, and those
   * are different failures. Several local models — the default one here among
   * them — write their whole deliberation into `reasoning_content`, which this
   * pipeline deliberately never reads aloud. So bytes keep arriving, the watchdog
   * keeps being reset by them, and the user watches an assistant produce nothing
   * at all with no ceiling and no explanation. That is exactly what "the tokens
   * stopped and it froze" looks like from the outside.
   *
   * Reasoning for a few seconds is normal and must not be punished. Reasoning past
   * a hard bound without a single visible character is a turn that is not going to
   * produce one.
   */
  describe('a model that streams nothing but its own thinking', () => {
    const readyCatalog = () => catalogInvoke.mockResolvedValue(okCatalog([STT_MODEL, TTS_MODEL]));

    const speaks = () =>
      synthesizeInvoke.mockImplementation(async () => ({
        ok: true,
        data: { audio: { dataBase64: pcm16ToWavBase64(pcmOf([1]), 22050), sampleRateHz: 22050 } },
      }));

    /** A stream that keeps sending reasoning frames and never any content. */
    const thinkingForever = (): ReadableStream<Uint8Array> => {
      const encoder = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'hmm ' } }] })}\n\n`)
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
        },
      });
    };

    const openThinking = async (events: NormalizedRealtimeEvent[], sent: string[]) => {
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/models')) {
          return { ok: true, json: async () => ({ data: [{ id: 'google/gemma-4-e4b' }] }) } as unknown as Response;
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: string }[] };
        const last = body.messages?.at(-1);
        if (last?.role === 'user') sent.push(last.content);
        return { ok: true, body: thinkingForever() } as unknown as Response;
      });
      vi.stubGlobal('fetch', fetchMock);

      const pipeline = new LocalVoicePipeline({
        // Deliberately the local path. These two tests are about what this class
        // does when the model streams nothing but its own thinking, and the
        // agent runtime does the thinking somewhere else entirely — left on,
        // `connect` reports that the bridge mocked above has no agent, and an
        // assertion about giving up too early catches that error instead.
        settings: settingsWith({ model: 'google/gemma-4-e4b', useAgentRuntime: false }),
        interfaceLanguage: 'tr',
        onEvent: (event: NormalizedRealtimeEvent) => void events.push(event),
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

    it('gives up once it is clear no answer is coming, rather than never', async () => {
      vi.useFakeTimers();
      try {
        readyCatalog();
        speaks();
        let asked = 0;
        transcribeInvoke.mockImplementation(async () => ({ ok: true, data: { text: `soru ${++asked}` } }));

        const events: NormalizedRealtimeEvent[] = [];
        const sent: string[] = [];
        const pipeline = await openThinking(events, sent);

        say(pipeline, 1);
        await drain();

        // Past the point where a reply that was ever going to start would have.
        await vi.advanceTimersByTimeAsync(SILENT_REPLY_MS + 2000);
        await drain();

        say(pipeline, 2);
        await drain();

        // The session survives it: the next question is actually sent.
        expect(sent).toContain('soru 2');
        expect(events.some((event) => event.kind === 'phase' && event.phase === 'listening')).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not punish a model that thinks for a few seconds first', async () => {
      vi.useFakeTimers();
      try {
        readyCatalog();
        speaks();
        transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'merhaba' } });

        const events: NormalizedRealtimeEvent[] = [];
        const sent: string[] = [];
        const pipeline = await openThinking(events, sent);

        say(pipeline, 1);
        await drain();
        await vi.advanceTimersByTimeAsync(5000);
        await drain();

        // Still going: five seconds of deliberation is a model working, not a
        // model stuck, and cutting it off there would be the worse bug.
        expect(events.some((event) => event.kind === 'error')).toBe(false);
        pipeline.close();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
