import type {
  VoiceCapability,
  VoiceCloneReferenceWav,
  VoicePcm16Wav,
  VoiceProviderId,
  VoiceSynthesizedWav,
} from '../../../common/types/foolVoice';
import { FoolVoiceSettings } from '../../../common/types/foolVoice';
import { VoiceModelCatalog } from './VoiceModelCatalog';
import type { VoiceModelManager } from './VoiceModelManager';
import type { SherpaVoiceProvider } from './SherpaVoiceProvider';
import type { OpenAICompatibleVoiceProvider } from './OpenAICompatibleVoiceProvider';

export class FoolVoiceService {
  private activeOperations = new Map<string, AbortController>();

  constructor(
    private modelManager: VoiceModelManager,
    private sherpaProvider: SherpaVoiceProvider,
    private openaiProvider: OpenAICompatibleVoiceProvider
  ) {}

  public async getHealth(
    providerId: VoiceProviderId,
    capability?: VoiceCapability,
    modelId?: string
  ): Promise<'ready' | 'unavailable' | 'unsupported'> {
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

  public async transcribe(
    operationId: string,
    providerId: VoiceProviderId,
    modelId: string,
    languageHint: string,
    audio: VoicePcm16Wav
  ): Promise<{ text: string; durationMs: number }> {
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

  public async synthesize(
    operationId: string,
    providerId: VoiceProviderId,
    modelId: string,
    profileId: string,
    language: string,
    speed: number,
    text: string
  ): Promise<{ audio: VoiceSynthesizedWav; durationMs: number }> {
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

  /**
   * How many speakers an installed local model carries.
   *
   * Falls back to the number of preset voices when the engine cannot be opened,
   * so the picker degrades to the catalog rather than to an empty list.
   */
  public async getSpeakerCount(modelId: string): Promise<{ speakerCount: number; source: 'engine' | 'catalog' }> {
    const state = await this.modelManager.getModelState(modelId);
    if (state.status !== 'ready') {
      return { speakerCount: this.presetSpeakerCount(modelId), source: 'catalog' };
    }

    try {
      return { speakerCount: await this.sherpaProvider.getSpeakerCount(modelId), source: 'engine' };
    } catch {
      return { speakerCount: this.presetSpeakerCount(modelId), source: 'catalog' };
    }
  }

  private presetSpeakerCount(modelId: string): number {
    const model = VoiceModelCatalog.getModels().find((entry) => entry.id === modelId);
    return model?.role === 'text-to-speech' ? model.profileIds.length : 0;
  }

  /**
   * Persists a voice cloned from a recording the renderer has already decoded
   * and normalised. Cloning has only ever had one engine that can use it
   * (Pocket, via `local-sherpa`), so unlike `transcribe`/`synthesize` there is
   * no provider branch here to keep in step.
   */
  public saveClonedVoice(
    voiceId: string,
    displayName: string,
    languages: readonly string[],
    referenceText: string,
    audio: VoiceCloneReferenceWav
  ): { profileId: string } {
    const wav = Buffer.from(audio.dataBase64, 'base64');
    return { profileId: this.sherpaProvider.saveClonedVoice(voiceId, displayName, languages, referenceText, wav) };
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
