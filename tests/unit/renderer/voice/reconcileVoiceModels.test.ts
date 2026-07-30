/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS, type VoiceModel } from '@/common/types/foolVoice';
import { reconcileVoiceModels } from '@renderer/services/voice/reconcileVoiceModels';

const speechModel = (id: string, installed: boolean, profileIds = ['voice-a'], languages = ['en']): VoiceModel =>
  ({
    id,
    providerId: 'local-sherpa',
    displayName: id,
    languages,
    role: 'text-to-speech',
    distribution: 'managed',
    state: installed ? { status: 'ready' } : { status: 'not-installed' },
    downloadBytes: null,
    installedBytes: null,
    audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 },
    profileIds,
  }) as VoiceModel;

const listenModel = (id: string, installed: boolean): VoiceModel =>
  ({
    id,
    providerId: 'local-sherpa',
    displayName: id,
    languages: ['tr', 'en'],
    role: 'speech-to-text',
    distribution: 'managed',
    state: installed ? { status: 'ready' } : { status: 'not-installed' },
    downloadBytes: null,
    installedBytes: null,
    audioInput: { container: 'wav', encoding: 'pcm16le', sampleRateHz: 16000, channels: 1 },
  }) as VoiceModel;

describe('reconcileVoiceModels', () => {
  it('leaves settings alone when the chosen models are installed', () => {
    const models = [
      listenModel(DEFAULT_FOOL_VOICE_SETTINGS.stt.modelId, true),
      speechModel(DEFAULT_FOOL_VOICE_SETTINGS.tts.modelId, true, [DEFAULT_FOOL_VOICE_SETTINGS.tts.profileId]),
    ];

    expect(reconcileVoiceModels(DEFAULT_FOOL_VOICE_SETTINGS, models)).toBeNull();
  });

  it('moves transcription onto a model that is actually installed', () => {
    const models = [
      listenModel(DEFAULT_FOOL_VOICE_SETTINGS.stt.modelId, false),
      listenModel('stt-whisper-tiny-int8-v1', true),
      speechModel(DEFAULT_FOOL_VOICE_SETTINGS.tts.modelId, true, [DEFAULT_FOOL_VOICE_SETTINGS.tts.profileId]),
    ];

    const next = reconcileVoiceModels(DEFAULT_FOOL_VOICE_SETTINGS, models);

    expect(next?.stt.modelId).toBe('stt-whisper-tiny-int8-v1');
    expect(next?.tts.modelId).toBe(DEFAULT_FOOL_VOICE_SETTINGS.tts.modelId);
  });

  it('moves the voice, and its voice id, onto an installed speech model', () => {
    const models = [
      listenModel(DEFAULT_FOOL_VOICE_SETTINGS.stt.modelId, true),
      speechModel(DEFAULT_FOOL_VOICE_SETTINGS.tts.modelId, false),
      speechModel('tts-kokoro-en-v0_19-int8', true, ['af_bella', 'am_adam'], ['en']),
    ];

    const next = reconcileVoiceModels(DEFAULT_FOOL_VOICE_SETTINGS, models);

    expect(next?.tts).toMatchObject({ modelId: 'tts-kokoro-en-v0_19-int8', profileId: 'af_bella', language: 'en' });
  });

  it('changes nothing when nothing is installed, so the install prompt still shows', () => {
    const models = [
      listenModel(DEFAULT_FOOL_VOICE_SETTINGS.stt.modelId, false),
      speechModel(DEFAULT_FOOL_VOICE_SETTINGS.tts.modelId, false),
    ];

    expect(reconcileVoiceModels(DEFAULT_FOOL_VOICE_SETTINGS, models)).toBeNull();
  });

  it('keeps a model the user chose deliberately and installed', () => {
    const settings = {
      ...DEFAULT_FOOL_VOICE_SETTINGS,
      stt: { ...DEFAULT_FOOL_VOICE_SETTINGS.stt, modelId: 'stt-whisper-tiny-int8-v1' },
      tts: { ...DEFAULT_FOOL_VOICE_SETTINGS.tts, modelId: 'tts-kokoro-en-v0_19-int8', profileId: 'am_adam' },
    };
    const models = [
      listenModel('stt-whisper-turbo', true),
      listenModel('stt-whisper-tiny-int8-v1', true),
      speechModel('tts-piper-en-libritts-r', true),
      speechModel('tts-kokoro-en-v0_19-int8', true, ['af_bella', 'am_adam']),
    ];

    expect(reconcileVoiceModels(settings, models)).toBeNull();
  });

  it('keeps a numbered voice on a model that is installed', () => {
    const settings = {
      ...DEFAULT_FOOL_VOICE_SETTINGS,
      stt: { ...DEFAULT_FOOL_VOICE_SETTINGS.stt, modelId: 'stt-whisper-turbo' },
      tts: { ...DEFAULT_FOOL_VOICE_SETTINGS.tts, modelId: 'tts-piper-en-libritts-r', profileId: 'speaker-457' },
    };
    const models = [listenModel('stt-whisper-turbo', true), speechModel('tts-piper-en-libritts-r', true)];

    expect(reconcileVoiceModels(settings, models)).toBeNull();
  });
});
