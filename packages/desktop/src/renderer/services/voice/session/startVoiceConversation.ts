/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import i18next from 'i18next';
import { ipcBridge } from '@/common';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type { ChatFileRef } from '@/common/types/chatFile';
import { chatFileRefPath } from '@/common/types/chatFile';
import { isFoolrsAssistant, type Assistant } from '@/common/types/agent/assistantTypes';
import type { FoolVoiceSettings } from '@/common/types/foolVoice';

/**
 * Opens the chat a spoken turn goes into, on the agent and model pinned for voice.
 *
 * Until now a first wake typed into the home composer, which meant the turn
 * inherited whatever that page happened to be pointed at and, worse, needed that
 * page to be mounted and painting. Both are wrong for hands-free use: the answer
 * should come from the same agent every time, and it should arrive with the
 * window minimised.
 *
 * So this creates the conversation directly and leaves the first message where
 * the conversation page already looks for one — the same `sessionStorage` handover
 * the home page uses, so nothing about how a turn is actually sent is duplicated
 * here.
 */

export type VoiceConversationRequest = {
  text: string;
  files?: readonly ChatFileRef[];
  settings: FoolVoiceSettings;
};

export type VoiceConversationResult =
  | { ok: true; conversationId: string }
  /** No agent is pinned, so the caller falls back to the home composer. */
  | { ok: false; reason: 'no-agent' }
  | { ok: false; reason: 'agent-missing' | 'no-model' | 'create-failed' };

/** Where the conversation page looks for the message that opened it. */
const initialMessageKey = (backend: 'foolrs' | 'acp', conversationId: string): string =>
  `${backend}_initial_message_${conversationId}`;

const readAssistants = async (): Promise<Assistant[]> => {
  try {
    return (await ipcBridge.assistants.list.invoke()) ?? [];
  } catch {
    return [];
  }
};

const readProviders = async (): Promise<IProvider[]> => {
  try {
    return (await ipcBridge.mode.listProviders.invoke()) ?? [];
  } catch {
    return [];
  }
};

/**
 * Finds the pinned assistant, tolerating the `builtin-` prefix.
 *
 * Built-in assistants are addressed both ways across the app, and a stored id
 * that no longer resolves would silence the wake word entirely.
 */
export const findPinnedAssistant = (assistants: readonly Assistant[], assistantId: string): Assistant | undefined => {
  const stripped = assistantId.replace(/^builtin-/, '');
  const candidates = new Set([assistantId, `builtin-${stripped}`, stripped]);
  return assistants.find((assistant) => candidates.has(assistant.id));
};

/**
 * Resolves the pinned model into the provider record a conversation needs.
 *
 * Returns undefined when nothing was pinned, or when the pinned pair no longer
 * exists — the assistant's own default is then used, which is better than
 * refusing to answer.
 */
export const findPinnedModel = (
  providers: readonly IProvider[],
  providerId: string,
  modelId: string
): TProviderWithModel | undefined => {
  if (modelId.length === 0) return undefined;

  const matches = (provider: IProvider): boolean =>
    (providerId.length === 0 || provider.id === providerId) && (provider.models ?? []).includes(modelId);

  const provider = providers.find(matches);
  if (!provider) return undefined;

  const { models: _models, ...rest } = provider;
  return { ...rest, use_model: modelId };
};

export const startVoiceConversation = async (request: VoiceConversationRequest): Promise<VoiceConversationResult> => {
  const { assistantId, providerId, modelId } = request.settings.session;
  if (assistantId.length === 0) return { ok: false, reason: 'no-agent' };

  const [assistants, providers] = await Promise.all([readAssistants(), readProviders()]);
  const assistant = findPinnedAssistant(assistants, assistantId);
  if (!assistant) return { ok: false, reason: 'agent-missing' };

  const model = findPinnedModel(providers, providerId, modelId);
  const files = request.files ?? [];
  const foolrs = isFoolrsAssistant(assistant);
  // The Fool CLI backend is handed the provider record itself, so without one
  // there is nothing to create the conversation with.
  if (foolrs && !model) return { ok: false, reason: 'no-model' };

  // An ACP agent names models in a namespace of its own: Hermes calls the LM
  // Studio model `lmstudio:qwen/qwen3.5-9b` where the The Fool provider calls the
  // same weights `qwen/qwen3.5-9b`. So a pinned id that matches no provider is
  // not a stale pin — it is the agent's own name for the model, and passing it
  // through unchanged is the only way the agent can resolve it. Without this the
  // override arrived empty and the agent answered on whatever model it was last
  // left on, which is exactly what pinning is supposed to prevent.
  const overrideModelId = model?.use_model ?? (modelId.length > 0 ? modelId : undefined);

  try {
    const conversation = await ipcBridge.conversation.create.invoke({
      name: request.text,
      ...(model ? { model } : {}),
      assistant: {
        id: assistant.id,
        locale: i18next.language || 'en-US',
        conversation_overrides: { model: overrideModelId },
      },
      extra: {
        workspace: '',
        custom_workspace: false,
        default_files: files.map(chatFileRefPath),
      },
    });

    if (!conversation?.id) return { ok: false, reason: 'create-failed' };

    sessionStorage.setItem(
      initialMessageKey(foolrs ? 'foolrs' : 'acp', conversation.id),
      JSON.stringify({ input: request.text, files: files.length > 0 ? files : undefined })
    );

    return { ok: true, conversationId: conversation.id };
  } catch {
    return { ok: false, reason: 'create-failed' };
  }
};
