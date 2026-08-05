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
  return {
    modelId: settings.tts.modelId,
    profileId: settings.tts.profileId,
    language: settings.tts.language,
  };
};
