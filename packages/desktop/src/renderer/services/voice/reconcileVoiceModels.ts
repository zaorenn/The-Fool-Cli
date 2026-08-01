/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { synthesisProviderFor, type FoolVoiceSettings, type VoiceModel } from '@/common/types/foolVoice';

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
    // A model with no presets of its own can only speak in a voice the user
    // cloned, so landing on one leaves the app mute — with no sign of why,
    // because the model really is installed and really is ready. Preferred, not
    // required: an engine like that is still better than no voice at all.
    const speech = ready('text-to-speech');
    const replacement =
      speech.find((model) => model.role === 'text-to-speech' && model.profileIds.length > 0) ?? speech[0];
    if (replacement && replacement.role === 'text-to-speech') {
      next = {
        ...next,
        tts: {
          ...next.tts,
          // The provider goes with the model. Left behind, it addressed an
          // audio.cpp voice to sherpa, which reports it as an unknown model.
          providerId: synthesisProviderFor(models, replacement.id),
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
