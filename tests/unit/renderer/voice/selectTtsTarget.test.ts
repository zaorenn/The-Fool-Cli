/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS } from '@/common/types/foolVoice';
import { isLikelyTurkish, selectTtsTarget } from '@renderer/services/voice/selectTtsTarget';

const settings = DEFAULT_FOOL_VOICE_SETTINGS;
const withTurkishInstalled = ['tts-piper-en-libritts-r', 'tts-piper-tr-fettah'];

describe('isLikelyTurkish', () => {
  it.each(['Değişiklikleri kaydettim', 'İki dosya güncellendi', 'bu bir test'])('detects Turkish: %s', (text) => {
    expect(isLikelyTurkish(text)).toBe(true);
  });

  it.each(['I changed two files', 'The tests pass'])('does not flag English: %s', (text) => {
    expect(isLikelyTurkish(text)).toBe(false);
  });
});

describe('selectTtsTarget', () => {
  it('uses the configured English voice for English text', () => {
    expect(selectTtsTarget('I fixed the login validation', settings, withTurkishInstalled)).toEqual({
      modelId: 'tts-piper-en-libritts-r',
      profileId: 'libritts-p0',
      language: 'en',
    });
  });

  it('switches to an installed Turkish voice for Turkish text', () => {
    expect(selectTtsTarget('İki dosyayı güncelledim', settings, withTurkishInstalled)).toEqual({
      modelId: 'tts-piper-tr-fettah',
      profileId: 'piper-tr-fettah-v2',
      language: 'tr',
    });
  });

  it('keeps the configured voice when no Turkish model is installed', () => {
    expect(selectTtsTarget('İki dosyayı güncelledim', settings, ['tts-piper-en-libritts-r'])).toEqual({
      modelId: 'tts-piper-en-libritts-r',
      profileId: 'libritts-p0',
      language: 'en',
    });
  });

  it('falls back to Supertonic when Piper Turkish is absent', () => {
    const target = selectTtsTarget('Değişiklikleri kaydettim', settings, ['tts-supertonic-3-int8-2026-05-11']);

    expect(target.modelId).toBe('tts-supertonic-3-int8-2026-05-11');
  });

  it('returns the configured target for empty text', () => {
    expect(selectTtsTarget('   ', settings, withTurkishInstalled).modelId).toBe('tts-piper-en-libritts-r');
  });

  it('does not switch when the user already configured a Turkish voice', () => {
    const turkishSettings = {
      ...settings,
      tts: {
        ...settings.tts,
        modelId: 'tts-supertonic-3-int8-2026-05-11',
        profileId: 'supertonic-speaker-3',
        language: 'tr',
      },
    };

    expect(selectTtsTarget('Değişiklikleri kaydettim', turkishSettings, withTurkishInstalled).profileId).toBe(
      'supertonic-speaker-3'
    );
  });
});
