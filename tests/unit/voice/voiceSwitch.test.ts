/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { decideVoiceSwitch, reachableVoices, type VoiceFamilyLookup } from '@/common/voice/voiceSwitch';

const CATALOGUE = [
  { id: 'tts-piper-female', providerId: 'local-sherpa', role: 'text-to-speech' },
  { id: 'tts-piper-male', providerId: 'local-sherpa', role: 'text-to-speech' },
  { id: 'tts-piper-other', providerId: 'local-sherpa', role: 'text-to-speech' },
  { id: 'tts-qwen', providerId: 'local-audiocpp', role: 'text-to-speech' },
  { id: 'tts-supertonic', providerId: 'local-audiocpp', role: 'text-to-speech' },
  { id: 'stt-whisper', providerId: 'local-sherpa', role: 'speech-to-text' },
] as const;

const lookup: VoiceFamilyLookup = (id) => CATALOGUE.find((voice) => voice.id === id);

describe('decideVoiceSwitch', () => {
  it('lets a voice change to another in its own family mid-conversation', () => {
    expect(decideVoiceSwitch('tts-piper-female', 'tts-piper-male', lookup)).toEqual({
      decision: 'allowed',
      modelId: 'tts-piper-male',
    });
    expect(decideVoiceSwitch('tts-piper-male', 'tts-piper-female', lookup).decision).toBe('allowed');
    expect(decideVoiceSwitch('tts-piper-female', 'tts-piper-other', lookup).decision).toBe('allowed');
  });

  /**
   * The rule the user asked for, in the words they used: Piper does not become
   * Qwen. A different engine is a different server and a cold model load —
   * seconds of silence in the middle of a sentence, then a different timbre.
   */
  it('refuses to cross to another engine, and says which two', () => {
    expect(decideVoiceSwitch('tts-piper-female', 'tts-qwen', lookup)).toEqual({
      decision: 'different-engine',
      from: 'local-sherpa',
      to: 'local-audiocpp',
    });
  });

  it('refuses in the other direction too', () => {
    expect(decideVoiceSwitch('tts-supertonic', 'tts-piper-male', lookup).decision).toBe('different-engine');
  });

  it('allows a change within the other family as readily as within Piper', () => {
    expect(decideVoiceSwitch('tts-qwen', 'tts-supertonic', lookup).decision).toBe('allowed');
  });

  it('does nothing when the requested voice is already speaking', () => {
    expect(decideVoiceSwitch('tts-piper-male', 'tts-piper-male', lookup).decision).toBe('same-voice');
  });

  it('will not switch to something that cannot speak', () => {
    expect(decideVoiceSwitch('tts-piper-male', 'stt-whisper', lookup)).toEqual({
      decision: 'not-a-speaking-voice',
      modelId: 'stt-whisper',
    });
  });

  it('names a voice it has never heard of rather than guessing', () => {
    expect(decideVoiceSwitch('tts-piper-male', 'tts-nonsense', lookup)).toEqual({
      decision: 'unknown-voice',
      modelId: 'tts-nonsense',
    });
  });

  /** Nothing is speaking yet, so there is no turn to interrupt. */
  it('lets any installed voice start when none is speaking', () => {
    expect(decideVoiceSwitch('', 'tts-qwen', lookup).decision).toBe('allowed');
  });
});

describe('reachableVoices', () => {
  it('offers only the family currently speaking', () => {
    expect(reachableVoices('tts-piper-female', CATALOGUE).map((voice) => voice.id)).toEqual([
      'tts-piper-female',
      'tts-piper-male',
      'tts-piper-other',
    ]);
  });

  it('never offers something that cannot speak', () => {
    for (const voice of reachableVoices('tts-piper-female', CATALOGUE)) {
      expect(voice.role).toBe('text-to-speech');
    }
  });

  it('offers every speaking voice when none is chosen yet', () => {
    expect(reachableVoices('', CATALOGUE)).toHaveLength(5);
  });
});
