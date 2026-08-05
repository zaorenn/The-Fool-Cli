/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS } from '@/common/types/foolVoice';
import { isLikelyTurkish, selectTtsTarget, type InstalledVoice } from '@renderer/services/voice/selectTtsTarget';

const settings = DEFAULT_FOOL_VOICE_SETTINGS;

/** An installed voice, named and with the languages it claims. */
const voice = (id: string, languages: readonly string[] = ['en']): InstalledVoice => ({ id, languages });

const withTurkishInstalled = [voice('tts-piper-en-libritts-r'), voice('tts-piper-tr-fettah', ['tr'])];

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
    expect(selectTtsTarget('İki dosyayı güncelledim', settings, [voice('tts-piper-en-libritts-r')])).toEqual({
      modelId: 'tts-piper-en-libritts-r',
      profileId: 'libritts-p0',
      language: 'en',
    });
  });

  // Supertonic installs and reports ready, but `sherpa-onnx-node` has no engine
  // for it: routing a reply there threw inside playback, where the failure is
  // swallowed, so the answer was never spoken at all.
  it('does not route Turkish to Supertonic, which cannot synthesise', () => {
    const target = selectTtsTarget('Değişiklikleri kaydettim', settings, [
      voice('tts-supertonic-3-int8-2026-05-11', ['tr']),
    ]);

    expect(target.modelId).toBe('tts-piper-en-libritts-r');
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

  /**
   * Whose voice gets to finish a Turkish sentence.
   *
   * A cloned voice was replaced by Fettah the moment a reply turned Turkish —
   * unannounced, mid-conversation, with no setting anywhere admitting to it. The
   * reported symptom was a Turkish preset "butting in where I did not want it",
   * and it was worst in the one case the user had gone to the most trouble for:
   * hearing a recording of themselves.
   */
  it('never replaces a cloned voice with a stranger, whatever the language', () => {
    const cloned = {
      ...settings,
      tts: { ...settings.tts, modelId: 'tts-pocket-audiocpp', profileId: 'cloned:jarvis', language: 'en' },
    };

    const target = selectTtsTarget('İki dosyayı güncelledim', cloned, [
      voice('tts-pocket-audiocpp'),
      voice('tts-piper-tr-fettah', ['tr']),
    ]);

    expect(target).toEqual({ modelId: 'tts-pocket-audiocpp', profileId: 'cloned:jarvis', language: 'en' });
  });

  it('leaves a preset alone when it speaks Turkish itself', () => {
    const pocket = {
      ...settings,
      tts: { ...settings.tts, modelId: 'tts-pocket-audiocpp', profileId: 'speaker-0', language: 'en' },
    };

    // Pocket declares Turkish because it was measured saying it.
    const target = selectTtsTarget('İki dosyayı güncelledim', pocket, [
      voice('tts-pocket-audiocpp', ['en', 'tr']),
      voice('tts-piper-tr-fettah', ['tr']),
    ]);

    expect(target.modelId).toBe('tts-pocket-audiocpp');
  });

  it('still rescues a preset that cannot say the sentence at all', () => {
    const target = selectTtsTarget('İki dosyayı güncelledim', settings, withTurkishInstalled);

    expect(target.modelId).toBe('tts-piper-tr-fettah');
  });
});
