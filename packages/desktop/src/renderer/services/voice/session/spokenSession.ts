/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import i18next from 'i18next';
import { ipcBridge } from '@/common';
import type { IMcpServer, IProvider } from '@/common/config/storage';
import { isFoolrsAssistant, type Assistant } from '@/common/types/agent/assistantTypes';
import type { FoolVoiceSettings } from '@/common/types/foolVoice';
import { buildPersonaInstructions, type SpokenVoice } from '@/common/realtime';
import { peekVoiceMemory } from './voiceMemoryStore';
import { peekLocalSkills } from './localSkillStore';
import { findPinnedAssistant, findPinnedModel } from './startVoiceConversation';

/**
 * The conversation a spoken session lives in.
 *
 * Until now a spoken conversation kept its own history, its own tool loop and
 * its own prompt in the renderer, and handed anything real to a *separate* chat
 * over IPC. That meant the assistant a person actually talks to could not read a
 * file, could not run a command, forgot everything past twelve turns and gave up
 * after four tool calls — not because those are hard, but because the loop it
 * ran was not the loop that has them.
 *
 * So a spoken session is now an ordinary conversation owned by the agent
 * runtime. What used to be assembled into a system prompt every turn — the
 * persona, the memory, the taught skills, any rule set out loud before it
 * started — travels once, as the session's own prompt.
 */

export type SpokenSessionInput = {
  settings: FoolVoiceSettings;
  /** The app's own language, for a persona that has to answer in it. */
  interfaceLanguage: string;
  /** The installed voices, so the persona can name one when asked to change. */
  voices: readonly SpokenVoice[];
  /** Rules set out loud before this session began. */
  sessionRules: readonly string[];
};

export type SpokenSessionResult =
  | { ok: true; conversationId: string }
  | {
      ok: false;
      reason:
        /** Voice settings name no agent and none is enabled, so there is nothing to talk to. */
        | 'no-agent'
        /** The pinned agent is gone, or needs a model it was not given. */
        | 'agent-unavailable'
        | 'create-failed';
      detail?: string;
    };

/**
 * The MCP servers the user has switched on.
 *
 * `enabled` means "checked by default in a new conversation", which is exactly
 * what a spoken session is — it simply never had anyone to check the box. An
 * empty list on failure: a session with fewer tools is worse than one that runs,
 * and one that never opens because a server list could not be read is worse than
 * both.
 */
const enabledMcpServerIds = async (): Promise<string[]> => {
  const servers = await ipcBridge.mcpService.listServers.invoke().catch((): IMcpServer[] => []);
  return (servers ?? []).filter((server) => server.enabled).map((server) => server.id);
};

/**
 * What the conversation list calls this.
 *
 * Named rather than left blank so a day of talking does not leave a column of
 * identical untitled rows, and dated rather than numbered so the newest is
 * obvious without opening any of them.
 */
const SPOKEN_CONVERSATION_NAME_FALLBACK = 'Spoken conversation';

const spokenConversationName = (): string => {
  // `t` answers with `undefined` before i18next has been initialised, and this
  // runs from a microphone rather than from a page — there is no guarantee the
  // UI has started. A conversation named `undefined` is worse than an English
  // one.
  const translated = i18next.t('settings.voice.spokenConversationName', {
    defaultValue: SPOKEN_CONVERSATION_NAME_FALLBACK,
  });
  return typeof translated === 'string' && translated.length > 0 ? translated : SPOKEN_CONVERSATION_NAME_FALLBACK;
};

/** The whole of what the assistant knows before anybody has said anything. */
const sessionPrompt = (input: SpokenSessionInput): string => {
  const realtime = input.settings.realtime;
  return buildPersonaInstructions({
    presetId: realtime.personaPresetId,
    customInstructions: realtime.customInstructions,
    language: realtime.language,
    interfaceLanguage: input.interfaceLanguage,
    wakePhrase: input.settings.activation.wakePhrase.phrase,
    memory: peekVoiceMemory(),
    voices: input.voices,
    carried: [],
    sessionRules: input.sessionRules,
    localSkills: peekLocalSkills(),
    files: [],
  });
};

/**
 * Opens the conversation a spoken session runs in.
 *
 * Never throws: the caller is a microphone, and an unhandled rejection there is
 * silence with no explanation.
 */
export const openSpokenSession = async (input: SpokenSessionInput): Promise<SpokenSessionResult> => {
  const { assistantId, providerId, modelId, unattended } = input.settings.session;

  const [assistants, providers] = await Promise.all([
    ipcBridge.assistants.list.invoke().catch((): Assistant[] => []),
    ipcBridge.mode.listProviders.invoke().catch((): IProvider[] => []),
  ]);

  // Nothing pinned falls back to the first enabled agent, as the delegated-task
  // path already does. Refusing outright is what once answered "open YouTube for
  // me" with an instruction to configure a setting that was at its default.
  const assistant = findPinnedAssistant(assistants ?? [], assistantId);
  if (!assistant) {
    return { ok: false, reason: assistantId.length === 0 ? 'no-agent' : 'agent-unavailable', detail: assistantId };
  }

  const model = findPinnedModel(providers ?? [], providerId, modelId);
  // The embedded backend is handed the provider record itself; without one there
  // is nothing to create the conversation with.
  if (isFoolrsAssistant(assistant) && !model) {
    return { ok: false, reason: 'agent-unavailable', detail: modelId };
  }

  // An ACP agent names models in its own namespace, so a pinned id matching no
  // provider is passed through rather than dropped.
  const overrideModelId = model?.use_model ?? (modelId.length > 0 ? modelId : undefined);
  const mcpIds = await enabledMcpServerIds();

  try {
    const conversation = await ipcBridge.conversation.create.invoke({
      name: spokenConversationName(),
      ...(model ? { model } : {}),
      assistant: {
        id: assistant.id,
        locale: i18next.language || 'en-US',
        conversation_overrides: {
          model: overrideModelId,
          // A spoken conversation cannot answer a confirmation: the prompt opens
          // in a window nobody is looking at, the turn waits on it, and the model
          // — having called a tool and been told nothing — says the work is done.
          // Stalling here is not the safe option; it is the one that produces a
          // false report.
          ...(unattended ? { permission: 'yolo' } : {}),
          ...(mcpIds.length > 0 ? { mcp_ids: mcpIds } : {}),
        },
      },
      extra: {
        workspace: '',
        custom_workspace: false,
        // Read at session build by `FoolrsBuildExtra` — see
        // `fool-conversation/src/session_context.rs`.
        system_prompt: sessionPrompt(input),
      },
    });

    if (!conversation?.id) return { ok: false, reason: 'create-failed' };
    return { ok: true, conversationId: conversation.id };
  } catch (error) {
    return { ok: false, reason: 'create-failed', detail: error instanceof Error ? error.message : undefined };
  }
};
