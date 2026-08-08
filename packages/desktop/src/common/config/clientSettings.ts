import type { FoolVoiceSettings } from '@/common/types/foolVoice';
import type { SpeechToTextConfig } from '@/common/types/provider/speech';
import type { IMcpServer, TProviderWithModel } from '@/common/config/storage';
import type { VoiceMemory } from '@/common/voice/memory';
import type { VoiceConversationLog } from '@/common/voice/conversationLog';

export type GoogleClientSetting = {
  proxy?: string;
};

export type ImageGenerationModelSetting = TProviderWithModel & {
  switch?: boolean;
};

export type ClientBusinessSettingMap = {
  'google.config': GoogleClientSetting;
  'mcp.config': IMcpServer[] | undefined;
  'tools.imageGenerationModel': ImageGenerationModelSetting | undefined;
  'tools.speechToText': SpeechToTextConfig | undefined;
  'fool.voice': FoolVoiceSettings | undefined;
  /**
   * Who the voice is talking to, kept separately from how it is configured.
   *
   * Its own key rather than a field on the settings: this is written by the
   * assistant during a conversation and the settings are written by the user in
   * a panel, so sharing one record would have every remembered name racing a
   * half-finished settings form.
   */
  'fool.voice.memory': VoiceMemory | undefined;
  /**
   * Spoken conversations, as they were actually said.
   *
   * Its own key rather than a field of the memory above, because the two are
   * written at completely different rates and for different reasons: the memory
   * is a short document changed when something is learned, and this grows by a
   * line every time anybody speaks. Sharing one record would have every
   * sentence rewrite the memory document, and one failed write lose both.
   */
  'fool.voice.conversations': VoiceConversationLog | undefined;
  'acp.promptTimeout': number | undefined;
  'acp.agentIdleTimeout': number | undefined;
};

export type ClientBusinessSettingKey = keyof ClientBusinessSettingMap;
