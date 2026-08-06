/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { findLayoutByName } from '@/common/config/surfaceLayouts';
import { synthesisProviderFor, type FoolVoiceSettings, type VoiceProfile } from '@/common/types/foolVoice';
import type { SpokenVoice } from '@/common/realtime/personas';
import { peekLayoutPresets, wearLayout } from '@renderer/hooks/system/useSurfaceLayout';
import { peekVoiceSettings, writeVoiceSettings } from '@renderer/services/voice/voiceSettingsStore';
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

    case 'thinking_model': {
      if (said.length === 0) bad();
      await save({ ...settings, realtime: { ...settings.realtime, model: said } });
      return t('settings.voice.conversationSettingThinkingModel', { name: said });
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
      const found = said.length === 0 ? null : findLayoutByName('voice', said, peekLayoutPresets());
      if (!found) return bad();
      await wearLayout('voice', found.id);
      return t('settings.voice.conversationSettingLayout', { name: found.name });
    }

    default:
      throw new Error(t('settings.voice.conversationActionUnsupported'));
  }
};
