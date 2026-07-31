/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveSherpaModule,
  SherpaVoiceProvider,
  type SherpaModule,
} from '@process/services/fool-voice/SherpaVoiceProvider';
import { AudioCodec } from '@process/services/fool-voice/audioCodec';

type GenerateRequest = { text: string; sid: number; speed: number };

/**
 * A stand-in engine with the surface the provider uses.
 *
 * Constructed with `new`, so these have to be real constructors rather than
 * arrow functions.
 */
const fakeModule = (speakers = 904) => {
  const generate = vi.fn((request: GenerateRequest) => ({
    samples: new Float32Array(2048).fill(0.1),
    sampleRate: 22050,
    request,
  }));
  const acceptWaveform = vi.fn();

  class FakeTts {
    public numSpeakers = speakers;
    public generate = generate;
  }

  const decode = vi.fn();
  const decodeAsync = vi.fn(async () => undefined);

  class FakeRecognizer {
    public createStream() {
      return { acceptWaveform };
    }
    public decode = decode;
    public decodeAsync = decodeAsync;
    public getResult() {
      return { text: 'hello there' };
    }
  }

  /** The same recogniser without the async binding, as an older build ships. */
  class FakeSyncOnlyRecognizer {
    public createStream() {
      return { acceptWaveform };
    }
    public decode = decode;
    public getResult() {
      return { text: 'hello there' };
    }
  }

  const module = { OfflineTts: FakeTts, OfflineRecognizer: FakeRecognizer } as unknown as SherpaModule;
  const syncOnlyModule = {
    OfflineTts: FakeTts,
    OfflineRecognizer: FakeSyncOnlyRecognizer,
  } as unknown as SherpaModule;
  return { module, syncOnlyModule, generate, acceptWaveform, decode, decodeAsync };
};

/** A one-sample mono 16 kHz WAV, enough for the codec to decode. */
const probeWav = () => {
  const samples = 160;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(samples * 2, 40);

  return {
    encoding: 'base64' as const,
    mimeType: 'audio/wav' as const,
    sampleRateHz: 16000 as const,
    channels: 1 as const,
    sampleFormat: 'pcm16le' as const,
    byteLength: buffer.byteLength,
    dataBase64: buffer.toString('base64'),
  };
};

describe('resolveSherpaModule', () => {
  it('accepts the exports a require returns', () => {
    const { module } = fakeModule();

    expect(resolveSherpaModule(module)).toBe(module);
  });

  it('unwraps the namespace object a dynamic import returns', () => {
    // This is the shape that made every engine fail with "not a constructor".
    const { module } = fakeModule();

    expect(resolveSherpaModule({ default: module })).toBe(module);
  });

  it('refuses a module with no engines rather than failing later at the call site', () => {
    expect(() => resolveSherpaModule({})).toThrow(/OfflineTts/);
    expect(() => resolveSherpaModule(null)).toThrow(/OfflineTts/);
  });
});

describe('SherpaVoiceProvider cloned voices', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sherpa-cloned-'));
    // The provider looks for cloned voices two levels above the model directory.
    const voice = path.join(root, 'cloned-voices', 'ultron');
    mkdirSync(voice, { recursive: true });
    writeFileSync(path.join(voice, 'reference.wav'), Buffer.from(probeWav().dataBase64, 'base64'));
    writeFileSync(
      path.join(voice, 'voice.json'),
      JSON.stringify({ displayName: 'Ultron', referenceText: 'How is humanity saved.' })
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const modelsDir = () => path.join(root, 'models', 'local-sherpa');

  // Cloning is not a trained artefact: the clip and its transcript travel with
  // every request, which is what `generationConfig` carries.
  it('speaks a cloned profile with the recording and its transcript', async () => {
    const { module, generate } = fakeModule();
    const provider = new SherpaVoiceProvider(modelsDir(), async () => module);

    await provider.synthesize('tts-zipvoice-distill-int8', 'cloned:ultron', 'en', 1, 'Hello');

    const request = generate.mock.calls[0][0] as {
      generationConfig?: { referenceText: string; referenceSampleRate: number; referenceAudio: Float32Array };
    };
    expect(request.generationConfig?.referenceText).toBe('How is humanity saved.');
    expect(request.generationConfig?.referenceSampleRate).toBe(16000);
    expect(request.generationConfig?.referenceAudio.length).toBeGreaterThan(0);
  });

  it('leaves a preset voice on the plain path, which routes to a different entry point', async () => {
    const { module, generate } = fakeModule();
    const provider = new SherpaVoiceProvider(modelsDir(), async () => module);

    await provider.synthesize('tts-piper-en-libritts-r', 'libritts-p0', 'en', 1, 'Hello');

    expect((generate.mock.calls[0][0] as { generationConfig?: unknown }).generationConfig).toBeUndefined();
  });

  // A voice whose files were deleted must not take the whole reply down with it.
  //
  // For an engine that has a voice of its own that means speaking in it. A
  // cloning engine has none — handed no reference it does not fall back, it
  // dies inside the addon, and a native crash closes every window. Refusing is
  // what keeps the app up, so the two engines part company here.
  it('falls back to the engine default when the recording has gone', async () => {
    const { module, generate } = fakeModule();
    const provider = new SherpaVoiceProvider(modelsDir(), async () => module);

    await provider.synthesize('tts-piper-en-libritts-r', 'cloned:nobody', 'en', 1, 'Hello');

    expect((generate.mock.calls[0][0] as { generationConfig?: unknown }).generationConfig).toBeUndefined();
  });

  it('refuses a cloning engine the same request, which has no default to fall back to', async () => {
    const { module, generate } = fakeModule();
    const provider = new SherpaVoiceProvider(modelsDir(), async () => module);

    await expect(provider.synthesize('tts-zipvoice-distill-int8', 'cloned:nobody', 'en', 1, 'Hello')).rejects.toThrow(
      /needs a reference recording/
    );
    // Refused before the engine is even built: loading one costs seconds, and
    // the crash is in the call it would then be handed.
    expect(generate).not.toHaveBeenCalled();
  });

  it('offers the cloned voice as a profile the picker can list', () => {
    const provider = new SherpaVoiceProvider(modelsDir());

    // One recording, offered against each engine that can render it.
    expect(new Set(provider.clonedProfiles().map((profile) => profile.id))).toEqual(new Set(['cloned:ultron']));
  });

  // A long answer is synthesised as several clips, and the reference travels
  // with each of them. Re-reading and re-decoding the recording every time made
  // the cost of cloning grow with the length of the reply for no reason: the
  // file has not changed between one clip and the next.
  it('decodes the recording once, however many clips are spoken', async () => {
    const { module } = fakeModule();
    const provider = new SherpaVoiceProvider(modelsDir(), async () => module);
    const decode = vi.spyOn(AudioCodec, 'decodePcm16Wav');

    for (const clip of ['First clip.', 'Second clip.', 'Third clip.']) {
      await provider.synthesize('tts-zipvoice-distill-int8', 'cloned:ultron', 'en', 1, clip);
    }

    expect(decode).toHaveBeenCalledTimes(1);
    decode.mockRestore();
  });

  it('decodes it again when the recording itself is replaced', async () => {
    const { module } = fakeModule();
    const provider = new SherpaVoiceProvider(modelsDir(), async () => module);

    await provider.synthesize('tts-zipvoice-distill-int8', 'cloned:ultron', 'en', 1, 'Before.');
    const decode = vi.spyOn(AudioCodec, 'decodePcm16Wav');
    const wav = path.join(root, 'cloned-voices', 'ultron', 'reference.wav');
    // A different length, so the recording is a different file by any measure.
    writeFileSync(wav, Buffer.concat([Buffer.from(probeWav().dataBase64, 'base64'), Buffer.alloc(320)]));
    await provider.synthesize('tts-zipvoice-distill-int8', 'cloned:ultron', 'en', 1, 'After.');

    expect(decode).toHaveBeenCalledTimes(1);
    decode.mockRestore();
  });

  it('picks up a recording that was replaced after it was first read', async () => {
    const { module, generate } = fakeModule();
    const provider = new SherpaVoiceProvider(modelsDir(), async () => module);

    await provider.synthesize('tts-zipvoice-distill-int8', 'cloned:ultron', 'en', 1, 'Before.');
    writeFileSync(
      path.join(root, 'cloned-voices', 'ultron', 'voice.json'),
      JSON.stringify({ displayName: 'Ultron', referenceText: 'A different line entirely.' })
    );
    await provider.synthesize('tts-zipvoice-distill-int8', 'cloned:ultron', 'en', 1, 'After.');

    const last = generate.mock.calls[generate.mock.calls.length - 1][0] as {
      generationConfig?: { referenceText: string };
    };
    expect(last.generationConfig?.referenceText).toBe('A different line entirely.');
  });
});

describe('SherpaVoiceProvider', () => {
  // Whisper spends the better part of a second on a few seconds of audio. Spent
  // synchronously it is spent inside the main process, which froze the window
  // the moment the dictation button came up.
  it('decodes off the main thread when the binding can', async () => {
    const { module, decode, decodeAsync } = fakeModule();
    const provider = new SherpaVoiceProvider('C:/models', async () => module);

    await provider.transcribe('stt-whisper-turbo', 'auto', probeWav());

    expect(decodeAsync).toHaveBeenCalledTimes(1);
    expect(decode).not.toHaveBeenCalled();
  });

  it('still decodes on a binding that predates the async call', async () => {
    const { syncOnlyModule, decode, decodeAsync } = fakeModule();
    const provider = new SherpaVoiceProvider('C:/models', async () => syncOnlyModule);

    await provider.transcribe('stt-whisper-turbo', 'auto', probeWav());

    expect(decode).toHaveBeenCalledTimes(1);
    expect(decodeAsync).not.toHaveBeenCalled();
  });

  it('synthesises through a loader that resolves an import namespace', async () => {
    const { module } = fakeModule();
    const provider = new SherpaVoiceProvider('C:/models', async () => ({ default: module }));

    const result = await provider.synthesize('tts-piper-en-libritts-r', 'libritts-p0', 'en', 1, 'hello');

    expect(result.audio.byteLength).toBeGreaterThan(0);
    expect(result.audio.sampleRateHz).toBe(22050);
  });

  it('reads the speaker count from the loaded engine', async () => {
    const { module } = fakeModule();
    const provider = new SherpaVoiceProvider('C:/models', async () => ({ default: module }));

    await expect(provider.getSpeakerCount('tts-piper-en-libritts-r')).resolves.toBe(904);
  });

  it('addresses a numbered voice by its speaker index', async () => {
    const { module, generate } = fakeModule();
    const provider = new SherpaVoiceProvider('C:/models', async () => module);

    await provider.synthesize('tts-piper-en-libritts-r', 'speaker-457', 'en', 1, 'hello');

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ sid: 457 }));
  });

  it('asks the engine to copy its samples, which Electron requires', async () => {
    const { module, generate } = fakeModule();
    const provider = new SherpaVoiceProvider('C:/models', async () => module);

    await provider.synthesize('tts-piper-en-libritts-r', 'libritts-p0', 'en', 1, 'hello');

    // An external buffer is rejected by Electron's V8 sandbox, which failed every
    // synthesis while looking like a broken model.
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ enableExternalBuffer: false }));
  });

  it('clamps a speaker index the model does not have', async () => {
    const { module, generate } = fakeModule(10);
    const provider = new SherpaVoiceProvider('C:/models', async () => module);

    await provider.synthesize('tts-piper-en-libritts-r', 'speaker-9999', 'en', 1, 'hello');

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ sid: 9 }));
  });

  it('uses the catalog speaker index for a preset voice', async () => {
    const { module, generate } = fakeModule();
    const provider = new SherpaVoiceProvider('C:/models', async () => module);

    // `libritts-p400` is speaker 400 in the catalog.
    await provider.synthesize('tts-piper-en-libritts-r', 'libritts-p400', 'en', 1, 'hello');

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ sid: 400 }));
  });

  it('rejects a model that is not a speech model at all', async () => {
    const { module } = fakeModule();
    const provider = new SherpaVoiceProvider('C:/models', async () => module);

    await expect(provider.synthesize('stt-whisper-turbo', 'x', 'en', 1, 'hello')).rejects.toThrow(/text-to-speech/);
  });

  it('hands the recogniser one waveform object, which is the only shape it takes', async () => {
    const { module, acceptWaveform } = fakeModule();
    const provider = new SherpaVoiceProvider('C:/models', async () => module);

    const text = await provider.transcribe('stt-whisper-turbo', 'auto', probeWav());

    // Positional arguments are rejected with "Argument 1 should be an object",
    // which failed every transcription while the model was perfectly fine.
    expect(acceptWaveform).toHaveBeenCalledTimes(1);
    const [waveform] = acceptWaveform.mock.calls[0];
    expect(waveform).toMatchObject({ sampleRate: 16000 });
    expect(waveform.samples).toBeInstanceOf(Float32Array);
    expect(text).toBe('hello there');
  });

  it('refuses to transcribe with a speech-output model', async () => {
    const { module } = fakeModule();
    const provider = new SherpaVoiceProvider('C:/models', async () => module);

    await expect(provider.transcribe('tts-piper-en-libritts-r', 'auto', probeWav())).rejects.toThrow(/speech-to-text/);
  });
});
