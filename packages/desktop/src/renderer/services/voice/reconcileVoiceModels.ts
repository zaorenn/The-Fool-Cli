/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FoolVoiceSettings, VoiceModel } from '@/common/types/foolVoice';

/**
 * Points the voice settings at models that are actually installed.
 *
 * The shipped defaults name the best models rather than the present ones, so a
 * fresh install has speech-to-text set to a half-gigabyte download. Leaving that
 * standing means the wake word cannot listen and transcription cannot run even
 * when the user has perfectly good models on disk — the selection has to follow
 * reality. A model the user picked *and installed* is never overridden.
 *
 * Returns null when nothing needs to change.
 */
export const reconcileVoiceModels = (
  settings: FoolVoiceSettings,
  models: readonly VoiceModel[]
): FoolVoiceSettings | null => {
  const ready = (role: VoiceModel['role']) =>
    models.filter((model) => model.role === role && model.state.status === 'ready');

  const isReady = (modelId: string) => models.some((model) => model.id === modelId && model.state.status === 'ready');

  let next = settings;

  if (!isReady(settings.stt.modelId)) {
    const replacement = ready('speech-to-text')[0];
    if (replacement) {
      next = { ...next, stt: { ...next.stt, modelId: replacement.id } };
    }
  }

  if (!isReady(settings.tts.modelId)) {
    const replacement = ready('text-to-speech')[0];
    if (replacement && replacement.role === 'text-to-speech') {
      next = {
        ...next,
        tts: {
          ...next.tts,
          modelId: replacement.id,
          // A voice id belongs to its model, so it moves with it.
          profileId: replacement.profileIds[0] ?? 'speaker-0',
          language: replacement.languages[0] ?? next.tts.language,
        },
      };
    }
  }

  return next === settings ? null : next;
};
