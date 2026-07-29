import {
  FoolVoiceSettings,
  VoiceCapability,
  VoicePcm16Wav,
  VoiceProviderId
} from '../../../common/types/foolVoice';
import { VoiceModelManager } from './VoiceModelManager';
import { SherpaVoiceProvider } from './SherpaVoiceProvider';
import { OpenAICompatibleVoiceProvider } from './OpenAICompatibleVoiceProvider';

export class FoolVoiceService {
  private activeOperations = new Map<string, AbortController>();

  constructor(
    private modelManager: VoiceModelManager,
    private sherpaProvider: SherpaVoiceProvider,
    private openaiProvider: OpenAICompatibleVoiceProvider
  ) {}

  public async getHealth(providerId: VoiceProviderId, capability?: VoiceCapability, modelId?: string): Promise<'ready' | 'unavailable' | 'unsupported'> {
    if (providerId === 'local-sherpa') {
      if (modelId) {
        const state = await this.modelManager.getModelState(modelId);
        if (state.status !== 'ready') return 'unavailable';
      }
      return this.sherpaProvider.getHealth(modelId || '');
    } else if (providerId === 'openai-compatible') {
      return this.openaiProvider.getHealth();
    }
    return 'unsupported';
  }

  public async transcribe(operationId: string, providerId: VoiceProviderId, modelId: string, languageHint: string, audio: VoicePcm16Wav): Promise<{ text: string; durationMs: number }> {
    const controller = new AbortController();
    this.activeOperations.set(operationId, controller);
    const startMs = Date.now();
    try {
      let text = '';
      if (providerId === 'local-sherpa') {
        text = await this.sherpaProvider.transcribe(modelId, languageHint, audio, controller.signal);
      } else if (providerId === 'openai-compatible') {
        text = await this.openaiProvider.transcribe(modelId, languageHint, audio, controller.signal);
      } else {
        throw new Error('unsupported');
      }
      return { text, durationMs: Date.now() - startMs };
    } finally {
      this.activeOperations.delete(operationId);
    }
  }

  public async synthesize(operationId: string, providerId: VoiceProviderId, modelId: string, profileId: string, language: string, speed: number, text: string): Promise<{ audio: VoicePcm16Wav; durationMs: number }> {
    const controller = new AbortController();
    this.activeOperations.set(operationId, controller);
    try {
      if (providerId === 'local-sherpa') {
        return await this.sherpaProvider.synthesize(modelId, profileId, language, speed, text, controller.signal);
      } else if (providerId === 'openai-compatible') {
        return await this.openaiProvider.synthesize(modelId, profileId, language, speed, text, controller.signal);
      } else {
        throw new Error('unsupported');
      }
    } finally {
      this.activeOperations.delete(operationId);
    }
  }

  public async cancel(operationId: string): Promise<'cancelling' | 'cancelled' | 'not-found' | 'already-terminal'> {
    const controller = this.activeOperations.get(operationId);
    if (controller) {
      controller.abort();
      this.activeOperations.delete(operationId);
      return 'cancelling';
    }
    return 'not-found';
  }
}
