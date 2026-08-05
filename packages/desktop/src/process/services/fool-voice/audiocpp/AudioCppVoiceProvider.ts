/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import type { VoiceEngineBackend, VoiceParams, VoiceSynthesizedWav } from '../../../../common/types/foolVoice';
import { ClonedVoiceStore, parseClonedProfileId } from '../ClonedVoiceStore';
import { AudioCppClient, type AudioCppSpeechRequest, type AudioCppSpeechResult } from './AudioCppClient';
import { AudioCppRuntime, type AudioCppRuntimeOptions, type AudioCppServerModel } from './AudioCppRuntime';
import { AUDIOCPP_MODEL_SPECS, getAudioCppModelSpec, presetSpeakerNameFor, wireParamsFor } from './audioCppEngineSpecs';

/**
 * The `local-audiocpp` provider.
 *
 * Offers `FoolVoiceService` the same surface `SherpaVoiceProvider` does —
 * `getHealth`, `synthesize`, cloned profiles — and delegates the actual work to
 * the Phase 1 runtime and client. Everything it touches from the outside world
 * is injected, so the tests exercise it against stubs and never launch a binary
 * or open a socket.
 *
 * The one shape difference from sherpa is that this provider is a *client of a
 * process*, not a loader of weights: the model directory is handed to a child
 * server through a generated config, and the reference clip for a cloned voice
 * is passed as a path for that child to read itself.
 */

/** What the installer knows, as this provider needs it. */
export type AudioCppInstallation = {
  /** Absolute path to `audiocpp_server.exe` for a build, or null when it is not installed. */
  engineBinaryPath: (backend: VoiceEngineBackend) => Promise<string | null>;
  /** Absolute directory holding a model's GGUF weights. */
  modelDir: (modelId: string) => string;
  /** Whether a model's weights and the build that runs them are both present. */
  modelReady: (modelId: string, backend: VoiceEngineBackend) => Promise<boolean>;
};

/** The slice of {@link AudioCppRuntime} this provider uses. */
export type AudioCppRuntimeHandle = {
  ensureRunning: () => Promise<{ baseUrl: string }>;
  shutdown: () => Promise<void>;
};

/** The slice of {@link AudioCppClient} this provider uses. */
export type AudioCppClientHandle = {
  synthesize: (request: AudioCppSpeechRequest) => Promise<AudioCppSpeechResult>;
};

export type AudioCppVoiceProviderDeps = {
  installation: AudioCppInstallation;
  /** Directory holding the user's cloned voices, shared with the sherpa provider. */
  clonedVoicesDir: string;
  /** Where the generated `server.json` is written. */
  configPath: string;
  createRuntime?: (options: AudioCppRuntimeOptions) => AudioCppRuntimeHandle;
  createClient?: (baseUrl: string) => AudioCppClientHandle;
};

/** Canonical PCM16 header fields, at the offsets `encode_pcm16_wav` writes them. */
const readWavFormat = (wav: Uint8Array): { sampleRateHz: number; channels: number; bitsPerSample: number } => {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  return {
    channels: view.getUint16(22, true),
    sampleRateHz: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
  };
};

export class AudioCppVoiceProvider {
  private readonly deps: Required<AudioCppVoiceProviderDeps>;
  private cloned: ClonedVoiceStore | null = null;
  private runtime: AudioCppRuntimeHandle | null = null;
  /**
   * The installed models the current runtime was configured for.
   *
   * A server's model list is fixed by the config it was spawned with, and there
   * is no route that loads a model at request time — so installing a second
   * voice while the first is running has to replace the process rather than be
   * ignored. Comparing signatures is what notices that.
   */
  private runtimeSignature = '';

  public constructor(deps: AudioCppVoiceProviderDeps) {
    this.deps = {
      createRuntime: (options) => new AudioCppRuntime(options),
      createClient: (baseUrl) => new AudioCppClient(baseUrl),
      ...deps,
    };
  }

  /** Voices cloned from the user's own recordings. */
  private clonedVoices(): ClonedVoiceStore {
    this.cloned ??= new ClonedVoiceStore(this.deps.clonedVoicesDir);
    return this.cloned;
  }

  /**
   * Reports readiness without starting anything.
   *
   * Deliberately not a `/health` call: the engine is a child process this app
   * spawns on demand, so "is it running right now" is not the question a settings
   * page is asking. What matters is whether the weights and the executable are
   * both on disk, which is also what makes the check instant.
   */
  public async getHealth(
    modelId: string,
    backend: VoiceEngineBackend = 'cpu'
  ): Promise<'ready' | 'unavailable' | 'unsupported'> {
    const spec = getAudioCppModelSpec(modelId);
    if (!spec) return 'unsupported';
    // A model that insists on a processor it has not been given is not
    // "unavailable pending a download" — nothing the installer does will help
    // until the setting changes.
    if (spec.requiresBackend && spec.requiresBackend !== backend) return 'unsupported';
    if ((await this.deps.installation.engineBinaryPath(backend)) === null) return 'unavailable';
    return (await this.deps.installation.modelReady(modelId, backend)) ? 'ready' : 'unavailable';
  }

  /** Every installed audio.cpp model, as the server config wants to see them. */
  private async installedServerModels(backend: VoiceEngineBackend): Promise<AudioCppServerModel[]> {
    const models: AudioCppServerModel[] = [];
    for (const spec of AUDIOCPP_MODEL_SPECS) {
      // A model that will not run on this processor is left out of the config
      // rather than loaded and refused: the server loads every entry it is
      // given, and a two-gigabyte one costs a minute to load and reject.
      if (spec.requiresBackend && spec.requiresBackend !== backend) continue;
      if (!(await this.deps.installation.modelReady(spec.modelId, backend))) continue;
      models.push({
        id: spec.serverModelId,
        family: spec.family,
        path: this.deps.installation.modelDir(spec.modelId),
        task: spec.task,
        mode: spec.mode,
      });
    }
    return models;
  }

  /** Starts the server, replacing one that was configured for a different model set. */
  private async ensureRuntime(backend: VoiceEngineBackend): Promise<{ baseUrl: string }> {
    const binaryPath = await this.deps.installation.engineBinaryPath(backend);
    if (binaryPath === null) throw new Error(`the audio.cpp ${backend} engine is not installed`);

    const models = await this.installedServerModels(backend);
    if (models.length === 0) throw new Error('no audio.cpp model is installed');

    // The processor is part of the signature, so switching it replaces the
    // child rather than leaving a CPU server answering CUDA requests: a server
    // is spawned with one backend for its whole life.
    const signature = JSON.stringify([binaryPath, models, backend]);
    if (this.runtime && this.runtimeSignature !== signature) {
      await this.runtime.shutdown();
      this.runtime = null;
    }
    this.runtimeSignature = signature;
    this.runtime ??= this.deps.createRuntime({
      binaryPath,
      configPath: this.deps.configPath,
      models,
      backend,
    });

    return this.runtime.ensureRunning();
  }

  /** Stops the server, so the weights it holds open can be deleted or replaced. */
  public async shutdown(): Promise<void> {
    const runtime = this.runtime;
    this.runtime = null;
    this.runtimeSignature = '';
    await runtime?.shutdown();
  }

  public async synthesize(
    modelId: string,
    profileId: string,
    language: string,
    _speed: number,
    text: string,
    params: VoiceParams | undefined,
    signal?: AbortSignal,
    backend: VoiceEngineBackend = 'cpu'
  ): Promise<{ audio: VoiceSynthesizedWav; durationMs: number }> {
    const spec = getAudioCppModelSpec(modelId);
    if (!spec) throw new Error(`Not an audio.cpp model: ${modelId}`);
    // Refused here rather than after the model loads: on a processor these two
    // take between forty seconds and two minutes a sentence, which is not a
    // slow answer but a broken feature.
    if (spec.requiresBackend && spec.requiresBackend !== backend) {
      throw new Error(`${modelId} needs the ${spec.requiresBackend} engine; the current setting is ${backend}`);
    }

    // Both models shipped here refuse a request with no speaker reference, so
    // the refusal is made here rather than paid for as a 500 after a cold model
    // load — which on CPU is tens of seconds spent to be told no.
    // A model with its own cast is addressed by name instead: it has nothing to
    // imitate, and a request that names nobody is refused with
    // `500 Qwen3 custom voice prefill requires speaker`.
    const presetSpeaker = presetSpeakerNameFor(modelId, profileId);
    const voiceId = presetSpeaker ? null : parseClonedProfileId(profileId);
    const voice = voiceId ? this.clonedVoices().find(voiceId) : null;
    if (spec.requiresVoiceReference && !voice) {
      throw new Error(`${modelId} speaks by cloning and needs a reference recording; profile "${profileId}" has none`);
    }

    const { baseUrl } = await this.ensureRuntime(backend);
    if (signal?.aborted) throw new Error('cancelled');

    const request: AudioCppSpeechRequest = {
      model: spec.serverModelId,
      input: text,
      // Top-level, not an option: the server folds it into the transcript, and a
      // model that reads its language from there never sees an `options.language`.
      language,
      ...(presetSpeaker ? { voice: presetSpeaker } : {}),
      ...(voice
        ? {
            // The server opens this file itself — there is no multipart branch
            // on the speech route and no base64 audio field — so it has to be
            // absolute rather than relative to the child's working directory.
            voiceRef: path.resolve(voice.referenceWavPath),
            ...(spec.usesReferenceText && voice.referenceText ? { referenceText: voice.referenceText } : {}),
          }
        : {}),
    };
    // `speed` has no counterpart here: the request body has no speed, pitch or
    // volume field at all, and inventing one out of a resample would change the
    // pitch of a voice the user cloned precisely to sound like someone.
    const wire = wireParamsFor(modelId, params);
    if (Object.keys(wire).length > 0) request.options = wire;

    const startMs = Date.now();
    const result = await this.deps.createClient(baseUrl).synthesize(request);
    if (signal?.aborted) throw new Error('cancelled');

    const format = readWavFormat(result.wav);
    if (format.channels !== 1 || format.bitsPerSample !== 16) {
      throw new Error(`audio.cpp returned ${format.channels}-channel ${format.bitsPerSample}-bit audio`);
    }

    // Passed through rather than decoded and re-encoded: the server already
    // emits mono PCM16 in a RIFF container, which is exactly what playback
    // wants, and a round-trip through Float32 would cost a copy of every sample
    // for no change in the bytes.
    const buffer = Buffer.from(result.wav);
    return {
      audio: {
        encoding: 'base64',
        mimeType: 'audio/wav',
        sampleRateHz: format.sampleRateHz,
        channels: 1,
        sampleFormat: 'pcm16le',
        byteLength: buffer.length,
        dataBase64: buffer.toString('base64'),
      },
      durationMs: Date.now() - startMs,
    };
  }
}
