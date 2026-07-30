/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { VoicePcm16Wav, VoiceSynthesizedWav } from '../../../common/types/foolVoice';
import { VoiceModelCatalog } from './VoiceModelCatalog';
import { AudioCodec } from './audioCodec';
import {
  canUseGpu,
  ENGINE_THREADS,
  getEngineSpec,
  type SttEngineSpec,
  type TtsEngineSpec,
  type VoiceCompute,
} from './voiceEngineSpecs';

export interface SherpaModule {
  OfflineRecognizer: new (config: unknown) => {
    createStream: () => {
      acceptWaveform: (rate: number, samples: Float32Array) => void;
      getResult: () => { text: string };
    };
    decode: (stream: unknown) => void;
  };
  OfflineTts: new (config: unknown) => {
    generate: (request: { text: string; sid: number; speed: number }) => { samples: Float32Array; sampleRate: number };
  };
}

/** Files a spec needs on disk, relative to the model directory. */
const requiredFiles = (spec: TtsEngineSpec | SttEngineSpec): string[] => {
  switch (spec.kind) {
    case 'vits':
      return [spec.model, 'tokens.txt'];
    case 'kokoro':
    case 'kitten':
      return [spec.model, spec.voices, 'tokens.txt'];
    case 'matcha':
      return [spec.acousticModel, spec.vocoder, 'tokens.txt'];
    case 'zipvoice':
      return [spec.encoder, spec.decoder, spec.vocoder, 'tokens.txt'];
    case 'whisper':
      return [spec.encoder, spec.decoder, spec.tokens];
    case 'transducer':
      return [spec.encoder, spec.decoder, spec.joiner, spec.tokens];
  }
};

export class SherpaVoiceProvider {
  private sherpaPromise: Promise<SherpaModule> | null = null;
  private recognizers = new Map<string, ReturnType<SherpaModule['OfflineRecognizer']['prototype']['constructor']>>();
  private synthesizers = new Map<string, InstanceType<SherpaModule['OfflineTts']>>();

  constructor(
    private modelsDir: string,
    private sherpaLoader: () => Promise<SherpaModule> = () =>
      import('sherpa-onnx-node') as unknown as Promise<SherpaModule>,
    /** Compute backend; `cuda` is only honoured for float models. */
    private compute: VoiceCompute = 'cpu'
  ) {}

  /** Switches backend at runtime; cached engines are dropped so they rebuild. */
  public setCompute(compute: VoiceCompute): void {
    if (compute === this.compute) return;
    this.compute = compute;
    this.recognizers.clear();
    this.synthesizers.clear();
  }

  public getCompute(): VoiceCompute {
    return this.compute;
  }

  private async getSherpa(): Promise<SherpaModule> {
    this.sherpaPromise ??= this.sherpaLoader();
    return this.sherpaPromise;
  }

  private modelDir(modelId: string, specDir: string): string {
    return path.join(this.modelsDir, modelId, specDir);
  }

  /** Resolves the execution provider for a model, refusing GPU where it would hurt. */
  private providerFor(modelId: string): VoiceCompute {
    return this.compute === 'cuda' && canUseGpu(modelId) ? 'cuda' : 'cpu';
  }

  /**
   * Reports readiness by checking the files the engine will actually open,
   * rather than assuming a loadable module means a usable model.
   */
  public async getHealth(modelId: string): Promise<'ready' | 'unavailable' | 'unsupported'> {
    const spec = getEngineSpec(modelId);
    if (!spec) return 'unsupported';

    try {
      await this.getSherpa();
    } catch {
      return 'unavailable';
    }

    const base = this.modelDir(modelId, spec.engine.dir);
    const missing = requiredFiles(spec.engine).some((file) => !existsSync(path.join(base, file)));
    return missing ? 'unavailable' : 'ready';
  }

  private buildTtsConfig(modelId: string, spec: TtsEngineSpec): unknown {
    const base = this.modelDir(modelId, spec.dir);
    const at = (file: string) => path.join(base, file);
    const shared = {
      numThreads: 2,
      provider: this.providerFor(modelId),
      debug: 0,
    };
    const dataDir = at('espeak-ng-data');
    const tokens = at('tokens.txt');

    switch (spec.kind) {
      case 'vits':
        return {
          model: { vits: { model: at(spec.model), tokens, dataDir }, ...shared },
          maxNumSentences: 1,
        };
      case 'kokoro':
        return {
          model: { kokoro: { model: at(spec.model), voices: at(spec.voices), tokens, dataDir }, ...shared },
          maxNumSentences: 1,
        };
      case 'kitten':
        return {
          model: { kitten: { model: at(spec.model), voices: at(spec.voices), tokens, dataDir }, ...shared },
          maxNumSentences: 1,
        };
      case 'matcha':
        return {
          model: {
            matcha: { acousticModel: at(spec.acousticModel), vocoder: at(spec.vocoder), tokens, dataDir },
            ...shared,
          },
          maxNumSentences: 1,
        };
      case 'zipvoice':
        return {
          model: {
            zipvoice: {
              encoder: at(spec.encoder),
              decoder: at(spec.decoder),
              vocoder: at(spec.vocoder),
              tokens,
              dataDir,
            },
            ...shared,
          },
          maxNumSentences: 1,
        };
    }
  }

  private buildSttConfig(modelId: string, spec: SttEngineSpec): unknown {
    const base = this.modelDir(modelId, spec.dir);
    const at = (file: string) => path.join(base, file);
    const shared = { numThreads: 2, provider: this.providerFor(modelId), debug: 0 };

    if (spec.kind === 'whisper') {
      return {
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          whisper: { encoder: at(spec.encoder), decoder: at(spec.decoder) },
          tokens: at(spec.tokens),
          ...shared,
        },
      };
    }

    return {
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: at(spec.encoder), decoder: at(spec.decoder), joiner: at(spec.joiner) },
        tokens: at(spec.tokens),
        ...(spec.modelType ? { modelType: spec.modelType } : {}),
        ...shared,
      },
    };
  }

  public async transcribe(
    modelId: string,
    _languageHint: string,
    audio: VoicePcm16Wav,
    signal?: AbortSignal
  ): Promise<string> {
    const sherpa = await this.getSherpa();
    if (signal?.aborted) throw new Error('cancelled');

    const spec = getEngineSpec(modelId);
    if (!spec || spec.role !== 'speech-to-text') throw new Error(`Not a speech-to-text model: ${modelId}`);

    const cacheKey = `${modelId}:${this.providerFor(modelId)}`;
    let recognizer = this.recognizers.get(cacheKey);
    if (!recognizer) {
      recognizer = new sherpa.OfflineRecognizer(this.buildSttConfig(modelId, spec.engine));
      this.recognizers.set(cacheKey, recognizer);
    }

    const { samples, sampleRate } = AudioCodec.decodePcm16Wav(Buffer.from(audio.dataBase64, 'base64'));
    const stream = recognizer.createStream();
    stream.acceptWaveform(sampleRate, samples);

    if (signal?.aborted) throw new Error('cancelled');
    recognizer.decode(stream);

    return stream.getResult().text;
  }

  public async synthesize(
    modelId: string,
    profileId: string,
    _language: string,
    speed: number,
    text: string,
    signal?: AbortSignal
  ): Promise<{ audio: VoiceSynthesizedWav; durationMs: number }> {
    const sherpa = await this.getSherpa();
    if (signal?.aborted) throw new Error('cancelled');

    const spec = getEngineSpec(modelId);
    if (!spec || spec.role !== 'text-to-speech') throw new Error(`Not a text-to-speech model: ${modelId}`);

    const cacheKey = `${modelId}:${this.providerFor(modelId)}`;
    let synthesizer = this.synthesizers.get(cacheKey);
    if (!synthesizer) {
      synthesizer = new sherpa.OfflineTts(this.buildTtsConfig(modelId, spec.engine));
      this.synthesizers.set(cacheKey, synthesizer);
    }

    // The speaker index comes from the catalog rather than from parsing the
    // profile id, so voice ids stay free-form.
    const profile = VoiceModelCatalog.getPresetProfiles().find((entry) => entry.id === profileId);
    const sid = profile && profile.kind === 'preset' ? profile.speakerId : 0;

    if (signal?.aborted) throw new Error('cancelled');

    const startMs = Date.now();
    // Deliberately the plain `{ text, sid, speed }` form: the alternative
    // `generationConfig` path routes to a different native entry point that
    // this binding version does not accept.
    const audioData = synthesizer.generate({ text, sid, speed });
    if (!audioData?.samples?.length) throw new Error('Synthesis produced no audio');
    if (signal?.aborted) throw new Error('cancelled');

    const buffer = AudioCodec.encodePcm16Wav(audioData.samples, audioData.sampleRate);
    return {
      audio: {
        encoding: 'base64',
        mimeType: 'audio/wav',
        sampleRateHz: audioData.sampleRate,
        channels: 1,
        sampleFormat: 'pcm16le',
        byteLength: buffer.length,
        dataBase64: buffer.toString('base64'),
      },
      durationMs: Date.now() - startMs,
    };
  }
}
