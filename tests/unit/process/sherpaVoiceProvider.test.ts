/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  resolveSherpaModule,
  SherpaVoiceProvider,
  type SherpaModule,
} from '@process/services/fool-voice/SherpaVoiceProvider';

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

  class FakeRecognizer {
    public createStream() {
      return { acceptWaveform };
    }
    public decode() {}
    public getResult() {
      return { text: 'hello there' };
    }
  }

  const module = { OfflineTts: FakeTts, OfflineRecognizer: FakeRecognizer } as unknown as SherpaModule;
  return { module, generate, acceptWaveform };
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

describe('SherpaVoiceProvider', () => {
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
