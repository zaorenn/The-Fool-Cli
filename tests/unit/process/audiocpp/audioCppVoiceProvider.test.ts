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
import { AudioCppVoiceProvider } from '@process/services/fool-voice/audiocpp/AudioCppVoiceProvider';
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
        shutdown: async () => undefined,
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
    // Every audio.cpp model, because on CUDA none of them is excluded.
    expect(spawnedWith[0].modelIds).toContain('qwen3-tts');
    expect(spawnedWith[0].modelIds).toContain('chatterbox');
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
    // Pocket runs anywhere; the two that do not are left out of the CPU config.
    expect(spawnedWith[0].modelIds).toEqual(['pocket']);
  });
});
