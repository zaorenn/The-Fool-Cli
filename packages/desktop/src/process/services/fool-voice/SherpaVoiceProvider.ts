/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { VoicePcm16Wav, VoiceSynthesizedWav } from '../../../common/types/foolVoice';
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

/** One utterance handed to a recogniser. */
export type SherpaOfflineStream = {
  /** Takes the waveform as one object; positional arguments are rejected. */
  acceptWaveform: (waveform: { samples: Float32Array; sampleRate: number }) => void;
};

export interface SherpaModule {
  OfflineRecognizer: new (config: unknown) => {
    createStream: () => SherpaOfflineStream;
    decode: (stream: SherpaOfflineStream) => void;
    /** The result belongs to the recogniser, not to the stream. */
    getResult: (stream: SherpaOfflineStream) => { text: string };
  };
  OfflineTts: new (config: unknown) => {
    generate: (request: {
      text: string;
      sid: number;
      speed: number;
      /** False makes the addon copy samples instead of handing out an external buffer. */
      enableExternalBuffer?: boolean;
    }) => { samples: Float32Array; sampleRate: number };
    /** Speakers the loaded weights carry; 904 for Piper LibriTTS-R, 1 for single-voice models. */
    numSpeakers: number;
  };
}

/**
 * Speaker ids the user picked by number rather than from the preset list.
 *
 * Multi-speaker models carry hundreds of voices with no names — LibriTTS-R has
 * 904 — so the catalog cannot enumerate them as presets. Any id of this shape
 * addresses the engine's speaker index directly.
 */
const DYNAMIC_SPEAKER_ID = /^speaker-(\d+)$/;

export const dynamicSpeakerId = (speakerIndex: number): string => `speaker-${speakerIndex}`;

export const parseDynamicSpeakerId = (profileId: string): number | null => {
  const match = DYNAMIC_SPEAKER_ID.exec(profileId);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
};

/**
 * Unwraps the addon however the loader handed it over.
 *
 * `sherpa-onnx-node` is CommonJS: a dynamic `import()` resolves to a namespace
 * object with the real exports under `default`, while `require` resolves to the
 * exports themselves. Reading `OfflineTts` off the wrong shape fails at the point
 * of use with "not a constructor" — which is exactly how local speech looked
 * broken while the model files were perfectly fine.
 */
export const resolveSherpaModule = (loaded: unknown): SherpaModule => {
  const hasEngines = (candidate: unknown): candidate is SherpaModule =>
    typeof candidate === 'object' &&
    candidate !== null &&
    (typeof (candidate as SherpaModule).OfflineTts === 'function' ||
      typeof (candidate as SherpaModule).OfflineRecognizer === 'function');

  if (hasEngines(loaded)) return loaded;

  const namespaced = (loaded as { default?: unknown } | null)?.default;
  if (hasEngines(namespaced)) return namespaced;

  throw new Error('sherpa-onnx-node loaded without OfflineTts/OfflineRecognizer');
};

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
    private sherpaLoader: () => Promise<SherpaModule | { default?: SherpaModule }> = () =>
      import('sherpa-onnx-node') as unknown as Promise<{ default?: SherpaModule }>,
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
    // Normalised on the way in, so every call site gets the engines themselves
    // rather than a module namespace wrapper.
    this.sherpaPromise ??= Promise.resolve(this.sherpaLoader()).then(resolveSherpaModule);
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
      numThreads: ENGINE_THREADS['text-to-speech'],
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
    const shared = { numThreads: ENGINE_THREADS['speech-to-text'], provider: this.providerFor(modelId), debug: 0 };

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

  /** Builds a speech engine once and reuses it; loading weights is the slow part. */
  private async getSynthesizer(modelId: string): Promise<InstanceType<SherpaModule['OfflineTts']>> {
    const sherpa = await this.getSherpa();

    const spec = getEngineSpec(modelId);
    if (!spec || spec.role !== 'text-to-speech') throw new Error(`Not a text-to-speech model: ${modelId}`);

    const cacheKey = `${modelId}:${this.providerFor(modelId)}`;
    const cached = this.synthesizers.get(cacheKey);
    if (cached) return cached;

    const synthesizer = new sherpa.OfflineTts(this.buildTtsConfig(modelId, spec.engine));
    this.synthesizers.set(cacheKey, synthesizer);
    return synthesizer;
  }

  private clampSpeaker(speakerIndex: number, speakerCount: number): number {
    if (!Number.isFinite(speakerCount) || speakerCount <= 0) return 0;
    return Math.max(0, Math.min(speakerCount - 1, speakerIndex));
  }

  /**
   * How many voices an installed model really has.
   *
   * Answered by the loaded engine, so the picker offers exactly the speakers the
   * downloaded weights contain instead of a hand-written guess.
   */
  public async getSpeakerCount(modelId: string): Promise<number> {
    const synthesizer = await this.getSynthesizer(modelId);
    const count = synthesizer.numSpeakers;
    return Number.isInteger(count) && count > 0 ? count : 1;
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
    // The binding takes one object — `acceptWaveform(rate, samples)` is rejected
    // with "Argument 1 should be an object", which failed every transcription.
    stream.acceptWaveform({ samples, sampleRate });

    if (signal?.aborted) throw new Error('cancelled');
    recognizer.decode(stream);

    // The result hangs off the recogniser, not the stream.
    return recognizer.getResult(stream).text;
  }

  public async synthesize(
    modelId: string,
    profileId: string,
    _language: string,
    speed: number,
    text: string,
    signal?: AbortSignal
  ): Promise<{ audio: VoiceSynthesizedWav; durationMs: number }> {
    const synthesizer = await this.getSynthesizer(modelId);
    if (signal?.aborted) throw new Error('cancelled');

    // Preset voices carry their speaker index in the catalog, which keeps those
    // ids free-form; a numbered `speaker-N` id addresses the engine directly, for
    // the hundreds of voices no catalog could list.
    const profile = VoiceModelCatalog.getPresetProfiles().find((entry) => entry.id === profileId);
    const sid =
      profile && profile.kind === 'preset'
        ? profile.speakerId
        : this.clampSpeaker(parseDynamicSpeakerId(profileId) ?? 0, synthesizer.numSpeakers);

    if (signal?.aborted) throw new Error('cancelled');

    const startMs = Date.now();
    // Deliberately the plain `{ text, sid, speed }` form: the alternative
    // `generationConfig` path routes to a different native entry point that
    // this binding version does not accept.
    //
    // `enableExternalBuffer: false` is not optional here. The addon hands back an
    // external buffer by default, which Electron's V8 sandbox rejects outright
    // with "External buffers are not allowed" — every synthesis failed on that
    // even though the model had loaded. Copying the samples costs a memcpy of a
    // few hundred kilobytes.
    const audioData = synthesizer.generate({ text, sid, speed, enableExternalBuffer: false });
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
