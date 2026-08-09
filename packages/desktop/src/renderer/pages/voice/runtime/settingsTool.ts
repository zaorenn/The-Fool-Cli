/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import { findPersonaByName, sanitizeSavedPersonas, VOICE_PERSONAS_CONFIG_KEY } from '@/common/realtime';
import { findLayoutByName, SURFACE_IDS } from '@/common/config/surfaceLayouts';
import { findWorkspaceByName } from '@/common/config/workspaces';
import { synthesisProviderFor, type FoolVoiceSettings, type VoiceProfile } from '@/common/types/foolVoice';
import type { SpokenVoice } from '@/common/realtime/personas';
import { peekLayoutPresets, wearLayout } from '@renderer/hooks/config/useSurfaceLayout';
import { enterWorkspace, peekWorkspaces } from '@renderer/hooks/config/useWorkspaces';
import { peekVoiceSettings, writeVoiceSettings } from '@renderer/services/voice/voiceSettingsStore';
import { normalizeEndpoint } from '../localPipeline';
import type { Translate } from './types';

/**
 * The settings panel, reachable out loud.
 *
 * Colours were the first thing to get here and made the case for the rest: the
 * setting existed, and getting to it meant leaving the conversation, finding the
 * page and coming back — which nobody does mid-sentence. Everything a person
 * would plausibly say about how the assistant behaves is now sayable.
 *
 * Two things are deliberately *not* here. Anything destructive — deleting a
 * cloned voice, resetting the whole configuration — because a misheard sentence
 * should not be able to do it. And anything the user cannot describe in words
 * without reading the screen first, which is most of the numeric knobs.
 */

/** What a spoken instruction may change. */
export const SPOKEN_SETTINGS = [
  'voice',
  'speed',
  'volume',
  'reply_language',
  'persona',
  'hold_to_talk',
  'unattended',
  'interrupt_word',
  'wake_phrase',
  'thinking_model',
  'vision_model',
  'layout',
  'workspace',
] as const;

export type SpokenSetting = (typeof SPOKEN_SETTINGS)[number];

const PERSONA_IDS = new Set(['companion', 'english-teacher', 'language-partner', 'interview-coach']);

/** Words that mean "on", in the languages the app is spoken in most. */
const AFFIRMATIVE = new Set([
  'on',
  'yes',
  'true',
  'enable',
  'enabled',
  'açık',
  'aç',
  'evet',
  'an',
  'ein',
  'oui',
  'sí',
  'si',
  'да',
  'так',
  '开',
  '是',
  'はい',
  '예',
]);

const asBoolean = (value: string): boolean => AFFIRMATIVE.has(value.trim().toLowerCase());

const asNumber = (value: string): number => Number.parseFloat(value.replace(',', '.').replace('%', ''));

/**
 * A multiplier, clamped to what the engines will take.
 *
 * "Twice as fast" arrives as `2` and "much faster" as whatever the model
 * decided; something past the end of the range is still an unambiguous request
 * to go to the end of it, so it is clamped rather than refused.
 */
const asSpeed = (value: string): number => {
  const parsed = asNumber(value);
  return Number.isNaN(parsed) ? Number.NaN : Math.min(2, Math.max(0.5, parsed));
};

/**
 * A volume, however it was said.
 *
 * Both "0.4" and "40" and "40%" mean the same thing out loud, and which one
 * arrives depends on the model rather than on the user — so anything above one
 * is read as a percentage. Unlike speed, there is no ambiguity to lose here: a
 * volume of four hundred percent does not exist.
 */
const asVolume = (value: string): number => {
  const parsed = asNumber(value);
  if (Number.isNaN(parsed)) return Number.NaN;
  return Math.min(1, Math.max(0, parsed > 1 ? parsed / 100 : parsed));
};

/**
 * The voices this computer can actually speak with, as the model should see them.
 *
 * Only what is installed and ready: offering a voice that has to be downloaded
 * first would have the assistant agree to something it cannot do, which is the
 * failure this whole area keeps coming back to. The label is the catalog's own
 * display name — "Bella (US, female)", "Adam (US, male)" — which is what lets
 * "use a male voice" be answered without a table of genders here.
 */
export const listSpokenVoices = async (): Promise<readonly SpokenVoice[]> => {
  const settings = peekVoiceSettings();
  const response = await ipcBridge.foolVoice.catalog.invoke({
    version: 1,
    requestId: crypto.randomUUID(),
    payload: { includeProfiles: true, backend: settings.tts.backend },
  });
  if (response.ok === false) return [];

  const ready = new Set(
    response.data.models
      .filter((model) => model.role === 'text-to-speech' && model.state.status === 'ready')
      .map((model) => model.id)
  );

  return response.data.profiles
    .filter((profile) => profile.state === 'ready' && ready.has(profile.modelId))
    .map((profile) => ({
      id: profile.id,
      label: profile.displayName,
      // A cloned voice is the user's own, and asked for by name far more often
      // than a preset is. Marked so the persona can say so rather than listing
      // it as one more reader.
      cloned: profile.kind === 'cloned',
    }));
};

/** Finds the voice a spoken instruction meant, by id first and then by name. */
const findVoice = (profiles: readonly VoiceProfile[], wanted: string): VoiceProfile | undefined => {
  const needle = wanted.trim().toLowerCase();
  if (needle.length === 0) return undefined;
  return (
    profiles.find((profile) => profile.id.toLowerCase() === needle) ??
    profiles.find((profile) => profile.displayName.toLowerCase() === needle) ??
    profiles.find((profile) => profile.displayName.toLowerCase().includes(needle))
  );
};

/** Lowercased, with everything a person does not say out loud removed. */
const plainly = (value: string): string => value.toLowerCase().replaceAll(/[^a-z0-9]/g, '');

/**
 * Which of the server's models the user meant.
 *
 * Nobody says "qwen slash qwen three point five dash nine b". They say "the
 * qwen one", or "nine b", and the transcript arrives with spaces where the
 * punctuation was — so the comparison is made on letters and digits alone.
 *
 * Shortest match wins. Asked for "qwen" with two of them loaded, the base model
 * is the one meant; the longer id is the one with something extra bolted on its
 * name, and if that is what was wanted they will say the extra part.
 */
export const findThinkingModel = (ids: readonly string[], said: string): string | null => {
  const wanted = plainly(said);
  if (wanted.length === 0) return null;

  const exact = ids.find((id) => id === said.trim() || plainly(id) === wanted);
  if (exact) return exact;

  const matches = ids
    .filter((id) => plainly(id).includes(wanted) || plainly(id).split('/').includes(wanted))
    .toSorted((left, right) => left.length - right.length);
  return matches[0] ?? null;
};

/**
 * What the local server currently has, or an empty list if it cannot be asked.
 *
 * Empty rather than a throw: a server that cannot be reached is a reason to say
 * so about the model, not to make the setting unreachable.
 */
const loadedModelIds = async (endpoint: string): Promise<string[]> => {
  try {
    const response = await fetch(`${endpoint}/models`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return [];
    const body = (await response.json()) as { data?: { id?: unknown }[] };
    return (body.data ?? []).map((entry) => entry.id).filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
};

/** Changes which voice speaks, and the engine that renders it along with it. */
const applyVoice = async (value: string, t: Translate): Promise<string> => {
  const settings = peekVoiceSettings();
  const response = await ipcBridge.foolVoice.catalog.invoke({
    version: 1,
    requestId: crypto.randomUUID(),
    payload: { includeProfiles: true, backend: settings.tts.backend },
  });
  if (response.ok === false) throw new Error(t('settings.voice.conversationSettingUnknownVoice', { name: value }));

  const ready = new Set(
    response.data.models
      .filter((model) => model.role === 'text-to-speech' && model.state.status === 'ready')
      .map((model) => model.id)
  );
  const usable = response.data.profiles.filter((profile) => profile.state === 'ready' && ready.has(profile.modelId));
  const chosen = findVoice(usable, value);
  if (!chosen) throw new Error(t('settings.voice.conversationSettingUnknownVoice', { name: value }));

  await writeVoiceSettings({
    ...settings,
    tts: {
      ...settings.tts,
      // The engine has to be recorded with the voice. A cloned voice appears
      // once per engine that can render it, so choosing one without saying
      // which engine sends every later request to whichever was stored first.
      providerId: synthesisProviderFor(response.data.models, chosen.modelId),
      modelId: chosen.modelId,
      profileId: chosen.id,
      language: chosen.languages[0] ?? settings.tts.language,
    },
  });

  return t('settings.voice.conversationSettingVoice', { name: chosen.displayName });
};

/**
 * Applies one spoken instruction about how the assistant behaves.
 *
 * @throws when the value is not one the setting can take, so the caller can say
 * what went wrong in a sentence rather than reporting a silent success.
 */
export const applySpokenSetting = async (setting: string, value: string, t: Translate): Promise<string> => {
  const said = value.trim();
  const settings = peekVoiceSettings();

  const save = async (next: FoolVoiceSettings): Promise<void> => {
    await writeVoiceSettings(next);
  };

  const named = (key: string): string => t(`settings.voice.conversationSettingName.${key}`);
  const bad = (): never => {
    throw new Error(t('settings.voice.conversationSettingBadValue', { setting: named(setting), value: said }));
  };

  switch (setting) {
    case 'voice':
      return applyVoice(said, t);

    case 'speed': {
      const speed = asSpeed(said);
      if (Number.isNaN(speed)) bad();
      await save({ ...settings, tts: { ...settings.tts, speed } });
      return t('settings.voice.conversationSettingSpeed', { value: speed.toFixed(2) });
    }

    case 'volume': {
      const volume = asVolume(said);
      if (Number.isNaN(volume)) bad();
      await save({ ...settings, playback: { ...settings.playback, volume } });
      return t('settings.voice.conversationSettingVolume', { value: Math.round(volume * 100) });
    }

    case 'reply_language': {
      // Kept as given rather than checked against a list: the app names twelve
      // languages and understands more, and refusing one that is merely not on
      // the picker would be refusing a request it can carry out.
      const language = said.toLowerCase() === 'auto' ? 'auto' : said.toLowerCase().slice(0, 8);
      if (language.length === 0) bad();
      await save({ ...settings, realtime: { ...settings.realtime, language } });
      return t('settings.voice.conversationSettingLanguage', { value: language });
    }

    case 'persona': {
      const preset = said.toLowerCase().replaceAll(' ', '-');
      // One they wrote themselves comes first, because a name they chose is a
      // name they meant. Their own "companion" should be theirs, not ours.
      const own = findPersonaByName(sanitizeSavedPersonas(configService.get(VOICE_PERSONAS_CONFIG_KEY)), said);
      if (own) {
        await save({
          ...settings,
          realtime: { ...settings.realtime, personaPresetId: 'custom', customInstructions: own.instructions },
        });
        return t('settings.voice.conversationSettingPersona', { name: own.name });
      }
      if (!PERSONA_IDS.has(preset)) bad();
      await save({
        ...settings,
        realtime: { ...settings.realtime, personaPresetId: preset as FoolVoiceSettings['realtime']['personaPresetId'] },
      });
      // Only from the next conversation: the persona is the instruction block a
      // session opened with, and it is not re-read mid-conversation. Said out
      // loud rather than quietly ignored — the alternative is an assistant that
      // agrees to become a language teacher and then does not.
      return t('settings.voice.conversationSettingPersona', { name: named(`persona.${preset}`) });
    }

    case 'hold_to_talk': {
      const on = asBoolean(said);
      await save({ ...settings, activation: { ...settings.activation, conversationHoldToTalk: on } });
      return on
        ? t('settings.voice.conversationSettingHoldToTalkOn')
        : t('settings.voice.conversationSettingHoldToTalkOff');
    }

    case 'unattended': {
      const on = asBoolean(said);
      await save({ ...settings, session: { ...settings.session, unattended: on } });
      return on
        ? t('settings.voice.conversationSettingUnattendedOn')
        : t('settings.voice.conversationSettingUnattendedOff');
    }

    case 'interrupt_word': {
      const word = said.slice(0, 40);
      if (word.length === 0) bad();
      await save({ ...settings, playback: { ...settings.playback, interruptible: true, interruptPhrase: word } });
      return t('settings.voice.conversationSettingInterruptWord', { word });
    }

    case 'wake_phrase': {
      const phrase = said.slice(0, 60);
      if (phrase.length === 0) bad();
      await save({
        ...settings,
        activation: {
          ...settings.activation,
          wakePhrase: { ...settings.activation.wakePhrase, phrase },
        },
      });
      return t('settings.voice.conversationSettingWakePhrase', { phrase });
    }

    /**
     * Which model does the thinking, changed without ending the conversation.
     *
     * Written straight through before, on whatever string the model produced.
     * A name the server does not have was confirmed out loud and then quietly
     * ignored for the rest of the session, because the running pipeline falls
     * back to what is actually loaded — so the user was told they had switched
     * and had not. The name is matched against the server's own list, and one
     * that matches nothing is refused by name.
     */
    case 'thinking_model': {
      if (said.length === 0) bad();
      const ids = await loadedModelIds(normalizeEndpoint(settings.realtime.localEndpoint));
      // No list means the server could not be asked. Refusing then would make
      // the setting unreachable whenever it is starting up, so the name is
      // taken at its word — which is what this did for every name before.
      const chosen = ids.length === 0 ? said : findThinkingModel(ids, said);
      if (!chosen) throw new Error(t('settings.voice.conversationSettingUnknownModel', { name: said }));

      await save({ ...settings, realtime: { ...settings.realtime, model: chosen } });
      return t('settings.voice.conversationSettingThinkingModel', { name: chosen });
    }

    case 'vision_model': {
      if (said.length === 0) bad();
      await save({ ...settings, realtime: { ...settings.realtime, visionModel: said } });
      return t('settings.voice.conversationSettingVisionModel', { name: said });
    }

    /**
     * The shape of the page they are looking at, changed by saying so.
     *
     * Matched loosely against the built-ins and against anything they have
     * saved, because a layout is referred to by whatever they called it — "put
     * the heads-up one on" is the request, not an id. A name that matches
     * nothing is refused by name rather than silently ignored: the user is
     * looking at the screen and would otherwise watch nothing happen.
     */
    case 'layout': {
      /**
       * Every window, not only this one.
       *
       * "Put the list one on" is a sentence about the Hub, and the person saying
       * it has no idea the app files layouts by window. Making them say which
       * window would be asking them to know the data model, so the name decides
       * the surface — a layout already knows what it is for. Searched in the
       * order the app lists its surfaces, so a name matching two windows lands
       * somewhere predictable rather than wherever the object happened to sit.
       */
      const presets = peekLayoutPresets();
      const found =
        said.length === 0
          ? null
          : SURFACE_IDS.map((surface) => findLayoutByName(surface, said, presets)).find((match) => match !== null);

      if (!found) return bad();
      await wearLayout(found.surface, found.id);
      return t('settings.voice.conversationSettingLayout', { name: found.name });
    }

    /**
     * The whole app aimed somewhere else, by saying so.
     *
     * A workspace moves the layout, the persona, the agent and the model at
     * once, so this is the largest thing a single sentence can change — which
     * is exactly why it has to be refused by name when it matches nothing
     * rather than half-applied or silently ignored.
     */
    case 'workspace': {
      const found = said.length === 0 ? null : findWorkspaceByName(peekWorkspaces(), said);
      if (!found) return bad();
      await enterWorkspace(found);
      return t('settings.voice.conversationSettingWorkspace', { name: found.name });
    }

    default:
      throw new Error(t('settings.voice.conversationActionUnsupported'));
  }
};
