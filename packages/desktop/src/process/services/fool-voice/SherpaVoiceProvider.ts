/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import path from 'node:path';
import type { VoicePcm16Wav, VoiceProfile, VoiceSynthesizedWav } from '../../../common/types/foolVoice';
import { ClonedVoiceStore, clonedProfileId, parseClonedProfileId } from './ClonedVoiceStore';
import { VoiceModelCatalog } from './VoiceModelCatalog';
import { AudioCodec } from './audioCodec';
import {
  canUseGpu,
  ENGINE_THREADS,
  getEngineSpec,
  isCloningTts,
  ttsThreadsFor,
  type SttEngineSpec,
  type TtsEngineSpec,
  type VoiceCompute,
} from './voiceEngineSpecs';

/** One utterance handed to a recogniser. */
export type SherpaOfflineStream = {
  /** Takes the waveform as one object; positional arguments are rejected. */
  acceptWaveform: (waveform: { samples: Float32Array; sampleRate: number }) => void;
};

/**
 * Cloning a voice, as the engine actually models it.
 *
 * There is no trained artefact: the reference clip and its transcript are handed
 * over with every request, and the engine speaks the new text in that voice.
 * Passing `generationConfig` routes to a different native entry point, which is
 * why it is only ever set when there is a reference to carry.
 */
export type SherpaGenerationConfig = {
  referenceAudio: Float32Array;
  referenceSampleRate: number;
  referenceText: string;
};

export type SherpaTtsRequest = {
  text: string;
  sid: number;
  speed: number;
  /** False makes the addon copy samples instead of handing out an external buffer. */
  enableExternalBuffer?: boolean;
  generationConfig?: SherpaGenerationConfig;
};

/**
 * Building an engine reads its weights off disk and into memory.
 *
 * ZipVoice's decoder alone is 124 MB, and the synchronous constructor spends
 * all of that inside the main process — every window frozen until it returns.
 * The async factories do the same work on a worker thread. Optional on the type
 * because the binding installed may predate them.
 */
export type SherpaRecognizer = {
  createStream: () => SherpaOfflineStream;
  decode: (stream: SherpaOfflineStream) => void;
  /**
   * Decodes on a worker thread instead of this one.
   *
   * Optional because this interface describes a binding that may be older
   * than the one installed; callers fall back to the blocking `decode`.
   */
  decodeAsync?: (stream: SherpaOfflineStream) => Promise<void>;
  /** The result belongs to the recogniser, not to the stream. */
  getResult: (stream: SherpaOfflineStream) => { text: string };
};

export type SherpaSynthesizer = {
  generate: (request: SherpaTtsRequest) => { samples: Float32Array; sampleRate: number };
  /** Generates on a worker thread instead of this one; optional like the above. */
  generateAsync?: (request: SherpaTtsRequest) => Promise<{ samples: Float32Array; sampleRate: number }>;
  /** Speakers the loaded weights carry; 904 for Piper LibriTTS-R, 1 for single-voice models. */
  numSpeakers: number;
};

export interface SherpaModule {
  OfflineRecognizer: (new (config: unknown) => SherpaRecognizer) & {
    createAsync?: (config: unknown) => Promise<SherpaRecognizer>;
  };
  OfflineTts: (new (config: unknown) => SherpaSynthesizer) & {
    createAsync?: (config: unknown) => Promise<SherpaSynthesizer>;
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

/**
 * How many cloned voices the engine keeps a speaker embedding for.
 *
 * Far more than anyone records, so switching between voices never costs the
 * derivation twice. The upstream example uses 50 and each entry is small.
 */
const VOICE_EMBEDDING_CACHE = 50;

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
      return [spec.encoder, spec.decoder, spec.vocoder, spec.lexicon, 'tokens.txt'];
    // No `tokens.txt`: Pocket carries its vocabulary as JSON instead.
    case 'pocket':
      return [
        spec.lmFlow,
        spec.lmMain,
        spec.encoder,
        spec.decoder,
        spec.textConditioner,
        spec.vocabJson,
        spec.tokenScoresJson,
      ];
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
  private cloned: ClonedVoiceStore | null = null;
  /**
   * Decoded reference clips, kept between requests.
   *
   * A cloned voice carries its recording with every call, and a long answer is
   * spoken as several clips — so the same file was being read and decoded once
   * per sentence. Held against the modification times of the two files it was
   * built from, which is what lets a re-recorded voice be picked up without
   * restarting the app.
   */
  private references = new Map<string, { config: SherpaGenerationConfig; stamp: string }>();

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
      numThreads: ttsThreadsFor(spec.kind, cpus().length),
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
              // Shipped with the model and needed for English pronunciation;
              // without it the engine falls back to guessing from spelling.
              lexicon: at(spec.lexicon),
            },
            ...shared,
          },
          maxNumSentences: 1,
        };
      case 'pocket':
        return {
          model: {
            pocket: {
              lmFlow: at(spec.lmFlow),
              lmMain: at(spec.lmMain),
              encoder: at(spec.encoder),
              decoder: at(spec.decoder),
              textConditioner: at(spec.textConditioner),
              vocabJson: at(spec.vocabJson),
              tokenScoresJson: at(spec.tokenScoresJson),
              // Speaker embeddings, kept between requests. Deriving one from the
              // recording is the expensive part of cloning, and a passage spoken
              // as several clips would otherwise pay it once per clip.
              voiceEmbeddingCacheCapacity: VOICE_EMBEDDING_CACHE,
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

    const config = this.buildTtsConfig(modelId, spec.engine);
    const synthesizer = sherpa.OfflineTts.createAsync
      ? await sherpa.OfflineTts.createAsync(config)
      : new sherpa.OfflineTts(config);
    this.synthesizers.set(cacheKey, synthesizer);
    return synthesizer;
  }

  /** Voices cloned from the user's own recordings, alongside the models. */
  private clonedVoices(): ClonedVoiceStore {
    this.cloned ??= new ClonedVoiceStore(path.join(this.modelsDir, '..', '..', 'cloned-voices'));
    return this.cloned;
  }

  /**
   * The reference a cloned profile speaks with, or nothing for a preset voice.
   *
   * A profile naming a voice whose files have gone is treated as no reference
   * rather than as an error: an engine with a voice of its own then speaks in
   * it, which is a worse answer than the one asked for and a better one than
   * silence. A cloning engine has no such voice, and {@link synthesize} refuses
   * the request before it reaches the addon — see the guard there.
   */
  private referenceFor(profileId: string): SherpaGenerationConfig | undefined {
    const voiceId = parseClonedProfileId(profileId);
    if (!voiceId) return undefined;

    const voice = this.clonedVoices().find(voiceId);
    if (!voice) return undefined;

    // Both files matter: the transcript is edited far more often than the
    // recording, and a stale one is heard as the voice mispronouncing itself.
    const stamp = this.referenceStamp(voice.referenceWavPath);
    const cached = this.references.get(profileId);
    if (cached && cached.stamp === stamp && cached.config.referenceText === voice.referenceText) {
      return cached.config;
    }

    const { samples, sampleRate } = AudioCodec.decodePcm16Wav(readFileSync(voice.referenceWavPath));
    const config: SherpaGenerationConfig = {
      referenceAudio: samples,
      referenceSampleRate: sampleRate,
      referenceText: voice.referenceText,
    };
    this.references.set(profileId, { config, stamp });
    return config;
  }

  /** Changes whenever the recording does, so a re-recorded voice is picked up. */
  private referenceStamp(wavPath: string): string {
    try {
      const { mtimeMs, size } = statSync(wavPath);
      return `${mtimeMs}:${size}`;
    } catch {
      // Unreadable stats mean the clip is re-read; a needless decode is a far
      // better outcome than speaking with a recording that is no longer there.
      return `unknown:${Date.now()}`;
    }
  }

  /** The cloned voices, as profiles the catalog can offer. */
  public clonedProfiles(): VoiceProfile[] {
    return this.clonedVoices().profiles();
  }

  /**
   * Writes a new cloned voice (or overwrites one with the same id) and hands
   * back the profile id it can be selected and verified under.
   *
   * Nothing here decodes or resamples: the caller (the renderer, which alone
   * has the Web Audio decoder) has already turned whatever file the user
   * dropped into mono 16-bit PCM at a rate the engine reads correctly.
   */
  public saveClonedVoice(
    voiceId: string,
    displayName: string,
    languages: readonly string[],
    referenceText: string,
    wav: Buffer
  ): string {
    this.clonedVoices().save(voiceId, displayName, languages, referenceText, wav);
    // A re-save changes reference.wav's mtime and size, so `referenceFor`'s
    // existing stamp check already reloads it — nothing to invalidate here.
    return clonedProfileId(voiceId);
  }

  /** Removes a voice cloned from a recording. A missing id is not an error. */
  public deleteClonedVoice(voiceId: string): void {
    this.clonedVoices().delete(voiceId);
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
      const config = this.buildSttConfig(modelId, spec.engine);
      recognizer = sherpa.OfflineRecognizer.createAsync
        ? await sherpa.OfflineRecognizer.createAsync(config)
        : new sherpa.OfflineRecognizer(config);
      this.recognizers.set(cacheKey, recognizer);
    }

    const { samples, sampleRate } = AudioCodec.decodePcm16Wav(Buffer.from(audio.dataBase64, 'base64'));
    const stream = recognizer.createStream();
    // The binding takes one object — `acceptWaveform(rate, samples)` is rejected
    // with "Argument 1 should be an object", which failed every transcription.
    stream.acceptWaveform({ samples, sampleRate });

    if (signal?.aborted) throw new Error('cancelled');
    // Whisper spends the better part of a second on a few seconds of audio, and
    // a synchronous decode spends all of it inside the main process — which is
    // exactly what froze the window at the moment the dictation button came up.
    // The async binding hands the work to a worker thread; the blocking call
    // stays as the fallback for a binding that predates it.
    if (recognizer.decodeAsync) await recognizer.decodeAsync(stream);
    else recognizer.decode(stream);

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
    // A cloned voice is a recording plus its transcript, not a speaker index, so
    // it overrides the id entirely and travels with the request.
    const generationConfig = this.referenceFor(profileId);

    // A cloning engine has no voice of its own to fall back on. Handed no
    // reference it does not return an error — it dies inside the addon, and
    // since that is a native crash it takes the whole app down with it, every
    // window and any unsaved work. Refuse before the engine is even loaded.
    //
    // Verifying one of these models is how a user meets this: the check runs the
    // model with no profile chosen, so nothing supplies a reference.
    const engine = getEngineSpec(modelId);
    if (engine?.role === 'text-to-speech' && isCloningTts(engine.engine.kind) && !generationConfig) {
      const errorMessage = `${modelId} speaks by cloning and needs a reference recording; profile "${profileId}" has none`;
      console.warn(`[SherpaVoiceProvider] ${errorMessage}`);
      throw new Error(errorMessage);
    }

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
    const request: SherpaTtsRequest = {
      text,
      sid,
      speed,
      enableExternalBuffer: false,
      ...(generationConfig ? { generationConfig } : {}),
    };
    // Synthesis runs off this thread where the binding allows it: done here, a
    // long passage blocks the main process and freezes every window with it.
    let audioData;
    try {
      audioData = synthesizer.generateAsync ? await synthesizer.generateAsync(request) : synthesizer.generate(request);
    } catch (err) {
      console.error('[SherpaVoiceProvider] Native addon crashed during synthesis:', err);
      throw new Error(`Sherpa native synthesis failed: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
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
