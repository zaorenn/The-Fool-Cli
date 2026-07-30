/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FoolVoiceSettings } from '@/common/types/foolVoice';

export type TtsTarget = {
  modelId: string;
  profileId: string;
  language: string;
};

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
 * Speech output defaults to natural English. A Turkish reply is spoken by an
 * installed Turkish voice instead; when none is installed the configured
 * default is used rather than failing, because a wrong accent beats silence.
 */
export const selectTtsTarget = (
  text: string,
  settings: FoolVoiceSettings,
  installedModelIds: readonly string[]
): TtsTarget => {
  const configured: TtsTarget = {
    modelId: settings.tts.modelId,
    profileId: settings.tts.profileId,
    language: settings.tts.language,
  };

  if (text.trim().length === 0 || !isLikelyTurkish(text)) return configured;
  if (configured.language === 'tr') return configured;

  return TURKISH_TARGETS.find((target) => installedModelIds.includes(target.modelId)) ?? configured;
};
