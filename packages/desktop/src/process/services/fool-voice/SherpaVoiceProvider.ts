import path from 'node:path';
import { VoicePcm16Wav } from '../../../common/types/foolVoice';
import { VoiceModelCatalog } from './VoiceModelCatalog';
import { AudioCodec } from './audioCodec';

export interface SherpaModule {
  OfflineRecognizer: any;
  OfflineTts: any;
  GenerationConfig?: any;
}

export class SherpaVoiceProvider {
  private sherpaPromise: Promise<SherpaModule> | null = null;
  private recognizers = new Map<string, any>();
  private synthesizers = new Map<string, any>();
  
  constructor(private modelsDir: string, private sherpaLoader: () => Promise<SherpaModule> = () => {
    // @ts-ignore
    return import('sherpa-onnx-node');
  }) {}

  private async getSherpa(): Promise<SherpaModule> {
    if (!this.sherpaPromise) {
      this.sherpaPromise = this.sherpaLoader();
    }
    return this.sherpaPromise;
  }

  public async getHealth(modelId: string): Promise<'ready' | 'unavailable' | 'unsupported'> {
    try {
      await this.getSherpa();
      const entry = VoiceModelCatalog.getManagedEntry(modelId);
      if (!entry) return 'unsupported';
      
      // If we got here, module loaded. Real health check should verify model exists.
      return 'ready';
    } catch {
      return 'unavailable';
    }
  }

  public async transcribe(modelId: string, languageHint: string, audio: VoicePcm16Wav, signal?: AbortSignal): Promise<string> {
    const sherpa = await this.getSherpa();
    if (signal?.aborted) throw new Error('cancelled');

    let recognizer = this.recognizers.get(modelId);
    if (!recognizer) {
      if (modelId !== 'stt-whisper-tiny-int8-v1') {
        throw new Error('Unsupported model');
      }
      const modelBase = path.join(this.modelsDir, modelId, 'sherpa-onnx-whisper-tiny');
      recognizer = new sherpa.OfflineRecognizer({
        featConfig: {
          sampleRate: 16000,
          featureDim: 80,
        },
        modelConfig: {
          whisper: {
            encoder: path.join(modelBase, 'tiny-encoder.int8.onnx'),
            decoder: path.join(modelBase, 'tiny-decoder.int8.onnx'),
          },
          tokens: path.join(modelBase, 'tiny-tokens.txt'),
          numThreads: 2,
          provider: 'cpu',
          debug: 0,
        },
      });
      this.recognizers.set(modelId, recognizer);
    }

    const buffer = Buffer.from(audio.dataBase64, 'base64');
    const { samples, sampleRate } = AudioCodec.decodePcm16Wav(buffer);

    const stream = recognizer.createStream();
    stream.acceptWaveform(sampleRate, samples);
    
    if (signal?.aborted) throw new Error('cancelled');
    recognizer.decode(stream);
    
    return stream.getResult().text;
  }

  public async synthesize(modelId: string, profileId: string, language: string, speed: number, text: string, signal?: AbortSignal): Promise<{ audio: VoicePcm16Wav, durationMs: number }> {
    const sherpa = await this.getSherpa();
    if (signal?.aborted) throw new Error('cancelled');

    let synthesizer = this.synthesizers.get(modelId);
    if (!synthesizer) {
      if (modelId !== 'tts-supertonic-3-int8-2026-05-11') {
        throw new Error('Unsupported model');
      }
      const modelBase = path.join(this.modelsDir, modelId, 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11');
      synthesizer = new sherpa.OfflineTts({
        model: {
          supertonic: {
            durationPredictor: path.join(modelBase, 'duration_predictor.int8.onnx'),
            textEncoder: path.join(modelBase, 'text_encoder.int8.onnx'),
            vectorEstimator: path.join(modelBase, 'vector_estimator.int8.onnx'),
            vocoder: path.join(modelBase, 'vocoder.int8.onnx'),
          },
          tokens: path.join(modelBase, 'tts.json'),
          numThreads: 2,
          provider: 'cpu',
          debug: 0,
        },
        maxNumSentences: 1,
      });
      this.synthesizers.set(modelId, synthesizer);
    }

    const speakerIdStr = profileId.replace('supertonic-speaker-', '');
    const speakerId = parseInt(speakerIdStr, 10);
    const sid = isNaN(speakerId) ? 0 : speakerId;

    if (signal?.aborted) throw new Error('cancelled');
    
    const startMs = Date.now();
    // According to docs, generate config takes extra lang parameter
    const generationConfig = {
      sid,
      speed,
      extra: { lang: language === 'tr' ? 'tr' : 'en' },
    };
    
    const audioData = synthesizer.generate({ text, generationConfig });
    if (!audioData) {
      throw new Error('Synthesis failed to produce audio data');
    }

    if (signal?.aborted) throw new Error('cancelled');

    const durationMs = Date.now() - startMs;

    const buffer = AudioCodec.encodePcm16Wav(audioData.samples, audioData.sampleRate);
    const wav: VoicePcm16Wav = {
      encoding: 'base64',
      mimeType: 'audio/wav',
      sampleRateHz: audioData.sampleRate,
      channels: 1,
      sampleFormat: 'pcm16le',
      byteLength: buffer.length,
      dataBase64: buffer.toString('base64'),
    };

    return { audio: wav, durationMs };
  }
}
