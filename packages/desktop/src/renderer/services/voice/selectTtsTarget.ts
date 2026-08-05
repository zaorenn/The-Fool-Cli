/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FoolVoiceSettings } from '@/common/types/foolVoice';

export type TtsTarget = {
  modelId: string;
  profileId: string;
  language: string;
};

/**
 * An installed voice, as much of it as choosing between them needs.
 *
 * The ids alone were not enough: whether the configured voice is overridden
 * depends on what it can say, and that is only on the model.
 */
export type InstalledVoice = {
  id: string;
  languages: readonly string[];
};

/**
 * Marks a profile as a recording of somebody rather than a shipped preset.
 *
 * Matches `CLONED_PROFILE_PREFIX` in the main process's `ClonedVoiceStore`.
 */
export const CLONED_PROFILE_PREFIX = 'cloned:';

/**
 * Turkish voices, in preference order, used when the reply is Turkish.
 *
 * Only voices the synthesiser can actually open belong here. Supertonic was
 * listed until it turned out `sherpa-onnx-node` carries no Supertonic engine at
 * all: a Turkish reply routed to it threw `Not a text-to-speech model` inside
 * playback, where the failure is swallowed, so the answer was simply never
 * spoken. An English voice reading Turkish is a bad accent; this was silence.
 */
const TURKISH_TARGETS: readonly TtsTarget[] = [
  { modelId: 'tts-piper-tr-fettah', profileId: 'piper-tr-fettah-v2', language: 'tr' },
];

/** Characters that occur in Turkish but not in English. */
const TURKISH_CHARACTERS = /[ğışçöüĞİŞÇÖÜ]/;

/** Frequent Turkish function words, for text that happens to avoid those letters. */
const TURKISH_WORDS =
  /\b(ve|bir|bu|icin|için|ile|olarak|degil|değil|var|yok|ama|daha|cok|çok|nasil|nasıl|evet|hayir|hayır)\b/i;

export const isLikelyTurkish = (text: string): boolean => TURKISH_CHARACTERS.test(text) || TURKISH_WORDS.test(text);

/**
 * Chooses which voice speaks a given reply.
 *
 * The voice the user picked speaks. The one exception is a reply in a language
 * that voice cannot say at all, where a preset that can say it beats a preset
 * reading it as nonsense — and even that stops short of replacing a cloned
 * voice, because a recording of yourself is never improved by a stranger.
 */
export const selectTtsTarget = (
  text: string,
  settings: FoolVoiceSettings,
  installed: readonly InstalledVoice[]
): TtsTarget => {
  const configured: TtsTarget = {
    modelId: settings.tts.modelId,
    profileId: settings.tts.profileId,
    language: settings.tts.language,
  };

  if (text.trim().length === 0 || !isLikelyTurkish(text)) return configured;
  if (configured.language === 'tr') return configured;

  // A cloned voice is the whole reason the user recorded one. Swapping it for
  // Fettah the moment a sentence turns Turkish is exactly the case where they
  // most wanted to hear themselves, and it arrived unannounced: same
  // conversation, different person, no setting anywhere admitting to it.
  if (configured.profileId.startsWith(CLONED_PROFILE_PREFIX)) return configured;

  // Nor is a preset overridden when it can speak the language itself. Pocket
  // declares Turkish because it was measured saying it; a voice that can say
  // the sentence has no reason to hand it to someone else.
  const chosen = installed.find((model) => model.id === configured.modelId);
  if (chosen?.languages.includes('tr')) return configured;

  return TURKISH_TARGETS.find((target) => installed.some((model) => model.id === target.modelId)) ?? configured;
};
