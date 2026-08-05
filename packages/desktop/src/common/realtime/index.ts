/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { geminiLiveAdapter, GEMINI_LIVE_DEFAULT_MODEL, GEMINI_LIVE_VOICES } from './geminiLive';
import { localS2SAdapter, LOCAL_S2S_ENDPOINT } from './localS2S';
import { openAIRealtimeAdapter, OPENAI_REALTIME_DEFAULT_MODEL, OPENAI_REALTIME_VOICES } from './openaiRealtime';
import type { RealtimeAdapter, RealtimeProviderId, RealtimeToolSchema, VoiceConversationProviderId } from './types';

const ADAPTERS: Record<RealtimeProviderId, RealtimeAdapter> = {
  'openai-realtime': openAIRealtimeAdapter,
  'gemini-live': geminiLiveAdapter,
  'local-s2s': localS2SAdapter,
};

export const getRealtimeAdapter = (providerId: RealtimeProviderId): RealtimeAdapter => ADAPTERS[providerId];

/**
 * What each provider needs from the settings page, in one place.
 *
 * The page offers a voice list and a model, and neither is shared: OpenAI's
 * voices are called `marin` and `cedar`, Gemini's are called `Puck` and `Kore`,
 * and the local pipeline has whatever its own configuration gave it. A picker
 * that offered the union of those would let the user choose a voice that fails
 * at connection time with a message from the provider.
 *
 * `platform` is the id used by the app's own provider list, which is where the
 * API key comes from — an OpenAI realtime session is paid for by the same
 * account as an OpenAI chat, and asking the user to enter the key twice would
 * be inventing a second place for it to be wrong.
 */
export type RealtimeProviderSpec = {
  id: VoiceConversationProviderId;
  /** Provider platforms whose credentials can open this kind of session. */
  platforms: readonly string[];
  defaultModel: string;
  voices: readonly string[];
  defaultVoice: string;
  /** True when the session needs an API key from the app's provider list. */
  requiresCredential: boolean;
};

export const REALTIME_PROVIDER_SPECS: Record<VoiceConversationProviderId, RealtimeProviderSpec> = {
  'openai-realtime': {
    id: 'openai-realtime',
    platforms: ['openai', 'openai-compatible', 'azure-openai', 'new-api'],
    defaultModel: OPENAI_REALTIME_DEFAULT_MODEL,
    voices: OPENAI_REALTIME_VOICES,
    defaultVoice: 'marin',
    requiresCredential: true,
  },
  'gemini-live': {
    id: 'gemini-live',
    platforms: ['gemini', 'google', 'google-gemini', 'vertexai'],
    defaultModel: GEMINI_LIVE_DEFAULT_MODEL,
    voices: GEMINI_LIVE_VOICES,
    defaultVoice: 'Puck',
    requiresCredential: true,
  },
  'local-s2s': {
    id: 'local-s2s',
    platforms: [],
    defaultModel: 'local',
    voices: ['default'],
    defaultVoice: 'default',
    requiresCredential: false,
  },
  // No voice list of its own: it speaks with whatever text-to-speech model the
  // voice settings installed, including a cloned one, and duplicating that
  // picker here would be a second place to choose the same thing. The model
  // named here is the one that thinks, and it is whatever the local server has
  // loaded — which is why the default is empty rather than a guess.
  'local-pipeline': {
    id: 'local-pipeline',
    platforms: [],
    defaultModel: '',
    voices: [],
    defaultVoice: '',
    requiresCredential: false,
  },
};

/**
 * Picker order, most useful first.
 *
 * The local pipeline leads because it is the only one that works on a fresh
 * install with nothing bought.
 */
export const REALTIME_PROVIDER_IDS: readonly VoiceConversationProviderId[] = [
  'local-pipeline',
  'openai-realtime',
  'gemini-live',
  'local-s2s',
];

/**
 * The things the voice may do to the app while a conversation is happening.
 *
 * Deliberately short. A speech-to-speech model calling a tool has to stop
 * speaking to do it, so every entry here is a pause in the conversation and has
 * to be worth one — which rules out the long tail of app settings and leaves
 * the two that come up out loud: change how it looks, and hand real work to the
 * agent that can do it.
 */
export const REALTIME_TOOLS: readonly RealtimeToolSchema[] = [
  {
    name: 'app_change_theme',
    description: "Change the application's accent colour. Use only when the user asks about how the app looks.",
    parameters: {
      type: 'object',
      properties: { tone: { type: 'string', enum: ['blue', 'violet', 'teal', 'warm', 'neutral'] } },
      required: ['tone'],
    },
  },
  {
    name: 'app_ask_jester',
    description:
      "Hand a real task on this computer to the built-in agent. It can read the user's screen and work their applications for them — click, fill in a form or a document, open something and use it — as well as handle files, code and research. Use it whenever the answer needs looking at the screen or doing something outside this conversation. Say briefly that you are on it; do not read the result out in full.",
    parameters: {
      type: 'object',
      properties: { request: { type: 'string', description: "The task, in the user's own words." } },
      required: ['request'],
    },
  },
  {
    name: 'app_standby',
    description:
      'Go quiet and wait. Call this the moment the user asks you to hold on, wait, stand by, or stop for now. After calling it, say nothing at all until you hear the wake phrase.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'app_resume',
    description:
      'Come back from waiting. Call this when you hear the wake phrase after standing by, then greet the user in a few words and pick the conversation up where it stopped.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

export { buildPersonaInstructions, PERSONA_PRESET_IDS, type PersonaPresetId } from './personas';
export { LOCAL_S2S_ENDPOINT };
export * from './types';
