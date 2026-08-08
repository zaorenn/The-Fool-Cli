/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioCppSpeechRequest } from '@process/services/fool-voice/audiocpp/AudioCppClient';
import {
  AUDIOCPP_IDLE_SHUTDOWN_MS,
  AudioCppVoiceProvider,
} from '@process/services/fool-voice/audiocpp/AudioCppVoiceProvider';
import { AUDIOCPP_CHATTERBOX_MODEL_ID, AUDIOCPP_QWEN3_MODEL_ID } from '@/common/types/foolVoice';

/**
 * How a voice is named on the wire, which is not the same question for every
 * engine here.
 *
 * Chatterbox has no voice of its own and is handed a recording to imitate;
 * Qwen3 ships a fixed cast and is handed a name. Getting that backwards is not
 * a type error and not a 400 — it is a minute of cold model load followed by
 * `500 Qwen3 custom voice prefill requires speaker`.
 */

/** A minimal 16-bit mono WAV header, which is all the provider inspects. */
const wavOf = (sampleRateHz: number): Uint8Array => {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint16(34, 16, true);
  return new Uint8Array(buffer);
};

let workspace = '';
let sent: AudioCppSpeechRequest[] = [];
let spawnedWith: { binaryPath: string; backend: string; modelIds: string[] }[] = [];
/** Teardowns of a spawned server, which is how the last model's weights are let go. */
let shutdowns = 0;

const providerFor = (clonedVoices: readonly { id: string; text: string }[] = []) => {
  const clonedDir = path.join(workspace, 'cloned');
  fs.mkdirSync(clonedDir, { recursive: true });
  for (const voice of clonedVoices) {
    const dir = path.join(clonedDir, voice.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'reference.wav'), Buffer.from(wavOf(24000)));
    fs.writeFileSync(
      path.join(dir, 'voice.json'),
      JSON.stringify({
        voiceId: voice.id,
        displayName: voice.id,
        languages: ['en'],
        referenceText: voice.text,
        referenceWav: 'reference.wav',
        createdAtMs: 0,
      })
    );
  }

  return new AudioCppVoiceProvider({
    clonedVoicesDir: clonedDir,
    configPath: path.join(workspace, 'server.json'),
    installation: {
      // One directory per build, as the installer lays them out.
      engineBinaryPath: async (backend) => path.join(workspace, backend, 'audiocpp_server.exe'),
      modelDir: (modelId) => path.join(workspace, modelId),
      modelReady: async () => true,
    },
    createRuntime: (options) => {
      spawnedWith.push({
        binaryPath: options.binaryPath,
        backend: options.backend,
        modelIds: options.models.map((model) => model.id),
      });
      return {
        ensureRunning: async () => ({ baseUrl: 'http://127.0.0.1:1' }),
        shutdown: async () => {
          shutdowns += 1;
        },
      };
    },
    createClient: () => ({
      synthesize: async (request) => {
        sent.push(request);
        return { wav: wavOf(24000), durationMs: 1 };
      },
    }),
  });
};

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'audiocpp-provider-'));
  sent = [];
  spawnedWith = [];
  shutdowns = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('AudioCppVoiceProvider', () => {
  it('names one of Qwen3’s own voices instead of sending a recording', async () => {
    const provider = providerFor();
    await provider.synthesize(AUDIOCPP_QWEN3_MODEL_ID, 'qwen3-ryan', 'en', 1, 'Hello.', undefined, undefined, 'cuda');

    expect(sent).toHaveLength(1);
    // `Ryan`, the model card's spelling — not the app's `qwen3-ryan` profile id,
    // which the engine answers with `500 unsupported speaker`.
    expect(sent[0].voice).toBe('Ryan');
    expect(sent[0].voiceRef).toBeUndefined();
    expect(sent[0].referenceText).toBeUndefined();
  });

  it('spells the language the way Qwen3 reads it', async () => {
    const provider = providerFor();
    await provider.synthesize(AUDIOCPP_QWEN3_MODEL_ID, 'qwen3-ryan', 'en', 1, 'Hello.', undefined, undefined, 'cuda');
    // `English`, not `en`. The engine matches this against a table of English
    // language names and answers a code with `500 unsupported language: en`, so
    // before this every Qwen3 request in the app had failed.
    expect(sent[0].language).toBe('English');

    await provider.synthesize(AUDIOCPP_QWEN3_MODEL_ID, 'qwen3-serena', 'zh', 1, '你好。', undefined, undefined, 'cuda');
    expect(sent[1].language).toBe('Chinese');
  });

  it('leaves the language alone for an engine that reads a code', async () => {
    const provider = providerFor([{ id: 'jarvis', text: 'Reference clip.' }]);
    await provider.synthesize(
      AUDIOCPP_CHATTERBOX_MODEL_ID,
      'cloned:jarvis',
      'en',
      1,
      'Hello.',
      undefined,
      undefined,
      'cuda'
    );
    expect(sent[0].language).toBe('en');
  });

  it('carries a spoken direction through as an option', async () => {
    const provider = providerFor();
    await provider.synthesize(
      AUDIOCPP_QWEN3_MODEL_ID,
      'qwen3-ryan',
      'en',
      1,
      'Hello.',
      { instruct: 'Speak in a slow, sad whisper.' },
      undefined,
      'cuda'
    );

    expect(sent[0].options).toEqual({ instruct: 'Speak in a slow, sad whisper.' });
  });

  it('hands Chatterbox the recording it has to imitate', async () => {
    const provider = providerFor([{ id: 'jarvis', text: 'Reference clip.' }]);
    await provider.synthesize(
      AUDIOCPP_CHATTERBOX_MODEL_ID,
      'cloned:jarvis',
      'en',
      1,
      'Hello.',
      { exaggeration: 1.4 },
      undefined,
      'cuda'
    );

    expect(sent[0].voice).toBeUndefined();
    expect(sent[0].voiceRef).toContain('jarvis');
    // Chatterbox builds its speaker embedding from the audio alone; the
    // transcript would land under a key it never reads.
    expect(sent[0].referenceText).toBeUndefined();
    expect(sent[0].options).toEqual({ exaggeration: 1.4 });
  });

  it('refuses before the model loads when a cloning engine has nothing to imitate', async () => {
    const provider = providerFor();
    await expect(
      provider.synthesize(
        AUDIOCPP_CHATTERBOX_MODEL_ID,
        'cloned:missing',
        'en',
        1,
        'Hello.',
        undefined,
        undefined,
        'cuda'
      )
    ).rejects.toThrow(/reference recording/);
    expect(sent).toHaveLength(0);
  });

  /**
   * Refused before anything is spawned, which is the whole value of it: these
   * weights take a minute to load on a processor and then produce a voice at a
   * minute a sentence.
   */
  it('will not run a graphics-card voice on the processor', async () => {
    const provider = providerFor();
    await expect(
      provider.synthesize(AUDIOCPP_QWEN3_MODEL_ID, 'qwen3-ryan', 'en', 1, 'Hello.', undefined, undefined, 'cpu')
    ).rejects.toThrow(/needs the cuda engine/);
    expect(spawnedWith).toHaveLength(0);
    expect(sent).toHaveLength(0);

    await expect(provider.getHealth(AUDIOCPP_QWEN3_MODEL_ID, 'cpu')).resolves.toBe('unsupported');
    await expect(provider.getHealth(AUDIOCPP_QWEN3_MODEL_ID, 'cuda')).resolves.toBe('ready');
  });

  it('spawns the build the setting asked for, carrying only what can run on it', async () => {
    const provider = providerFor();
    await provider.synthesize(AUDIOCPP_QWEN3_MODEL_ID, 'qwen3-ryan', 'en', 1, 'Hello.', undefined, undefined, 'cuda');

    expect(spawnedWith).toHaveLength(1);
    expect(spawnedWith[0].backend).toBe('cuda');
    expect(spawnedWith[0].binaryPath).toContain(path.join('cuda', 'audiocpp_server.exe'));
    // One entry, not every installed model. The server loads everything it is
    // given and holds it for the whole life of the process, so a config listing
    // the library put gigabytes of unused weights on the graphics card.
    expect(spawnedWith[0].modelIds).toEqual(['qwen3-tts']);
  });

  /**
   * A server is spawned with one backend for its whole life, so changing the
   * setting has to replace the child rather than leave a processor-only server
   * answering requests that were meant for the graphics card.
   */
  it('replaces the server when the processor changes under it', async () => {
    const provider = providerFor([{ id: 'jarvis', text: 'Reference clip.' }]);
    await provider.synthesize('tts-audiocpp-pocket', 'cloned:jarvis', 'en', 1, 'One.', undefined, undefined, 'cpu');
    await provider.synthesize('tts-audiocpp-pocket', 'cloned:jarvis', 'en', 1, 'Two.', undefined, undefined, 'cpu');
    expect(spawnedWith).toHaveLength(1);

    await provider.synthesize('tts-audiocpp-pocket', 'cloned:jarvis', 'en', 1, 'Three.', undefined, undefined, 'cuda');
    expect(spawnedWith.map((spawn) => spawn.backend)).toEqual(['cpu', 'cuda']);
  });

  /**
   * The reason the config carries one model: letting the last one go.
   *
   * Qwen3 stayed resident until the app was closed. Choosing another voice did
   * not change the config, so it did not replace the child holding its weights,
   * so a card kept gigabytes for a voice nobody had selected. The model is part
   * of the runtime signature now, which is what turns a switch into a teardown.
   */
  it('replaces the server when the voice changes, so the last model is let go', async () => {
    const provider = providerFor([{ id: 'jarvis', text: 'Reference clip.' }]);
    await provider.synthesize(AUDIOCPP_QWEN3_MODEL_ID, 'qwen3-ryan', 'en', 1, 'One.', undefined, undefined, 'cuda');
    await provider.synthesize(AUDIOCPP_QWEN3_MODEL_ID, 'qwen3-ryan', 'en', 1, 'Two.', undefined, undefined, 'cuda');
    // The same voice twice restarts nothing: the cost is paid on a real change,
    // not on every sentence.
    expect(spawnedWith).toHaveLength(1);
    expect(shutdowns).toBe(0);

    await provider.synthesize('tts-audiocpp-pocket', 'cloned:jarvis', 'en', 1, 'Three.', undefined, undefined, 'cuda');

    expect(spawnedWith.map((spawn) => spawn.modelIds)).toEqual([['qwen3-tts'], ['pocket']]);
    expect(shutdowns).toBe(1);
  });

  /**
   * The server used to be stopped only when the app closed or a model was
   * deleted, so one spoken sentence left it holding its weights for the rest of
   * the session — gigabytes of graphics memory on an otherwise idle machine.
   */
  it('lets the card go when nobody has spoken for a while', async () => {
    vi.useFakeTimers();
    try {
      const provider = providerFor([{ id: 'jarvis', text: 'Reference clip.' }]);
      await provider.synthesize('tts-audiocpp-pocket', 'cloned:jarvis', 'en', 1, 'One.', undefined, undefined, 'cpu');
      expect(shutdowns).toBe(0);

      // A pause shorter than the timeout is not idleness.
      await vi.advanceTimersByTimeAsync(AUDIOCPP_IDLE_SHUTDOWN_MS - 1000);
      expect(shutdowns).toBe(0);

      await vi.advanceTimersByTimeAsync(2000);
      expect(shutdowns).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not unload while someone is still talking to it', async () => {
    vi.useFakeTimers();
    try {
      const provider = providerFor([{ id: 'jarvis', text: 'Reference clip.' }]);
      await provider.synthesize('tts-audiocpp-pocket', 'cloned:jarvis', 'en', 1, 'One.', undefined, undefined, 'cpu');
      await vi.advanceTimersByTimeAsync(AUDIOCPP_IDLE_SHUTDOWN_MS - 5000);
      // Speaking again restarts the countdown; the last thing said wins.
      await provider.synthesize('tts-audiocpp-pocket', 'cloned:jarvis', 'en', 1, 'Two.', undefined, undefined, 'cpu');
      await vi.advanceTimersByTimeAsync(AUDIOCPP_IDLE_SHUTDOWN_MS - 5000);

      expect(shutdowns).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
