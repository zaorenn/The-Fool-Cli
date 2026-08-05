/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  AUDIOCPP_POCKET_MODEL_ID,
  CLONING_MODEL_ID,
  DEFAULT_FOOL_VOICE_SETTINGS,
  WAKE_SENSITIVITY_DEFAULT,
  FOOL_VOICE_PROVIDERS,
  FOOL_VOICE_SCHEMA_VERSION,
  PUSH_TO_TALK_DEFAULT,
  isVoiceDownloadProgressTransitionAllowed,
  isVoiceTurnTransitionAllowed,
  loadFoolVoiceSettings,
  localProviderFor,
  synthesisProviderFor,
  parseFoolVoiceSettings,
  type VoiceDownloadProgress,
  type VoiceModel,
  type VoiceProfile,
  type VoiceTurnState,
} from '@/common/types/foolVoice';

const normal = { status: 'normal' } as const;

const state = (
  phase: VoiceTurnState['phase'],
  details: Record<string, unknown> = {},
  condition: VoiceTurnState['condition'] = normal
): VoiceTurnState =>
  ({
    phase,
    condition,
    enteredAtMs: 1,
    ...details,
  }) as VoiceTurnState;

describe('Fool voice settings contract', () => {
  it('defaults to an inactive local configuration with the fastest measured voices', () => {
    expect(DEFAULT_FOOL_VOICE_SETTINGS).toMatchObject({
      schemaVersion: FOOL_VOICE_SCHEMA_VERSION,
      enabled: false,
      devices: { inputDeviceId: null, outputDeviceId: null },
      activation: {
        talkModeEnabled: false,
        pushToTalkShortcut: PUSH_TO_TALK_DEFAULT,
        // The wake phrase ships enabled because the desktop pet is the switch:
        // the listener only opens the microphone while the pet is on screen.
        wakePhrase: {
          enabled: true,
          modelId: 'stt-phrase-v1',
          phrase: 'wake up fool',
          sensitivity: WAKE_SENSITIVITY_DEFAULT,
        },
      },
      stt: { providerId: 'local-sherpa', modelId: 'stt-whisper-turbo', language: 'auto' },
      tts: {
        providerId: 'local-sherpa',
        modelId: 'tts-piper-en-libritts-r',
        profileId: 'libritts-p0',
        language: 'en',
        speed: 1,
      },
      narrator: { mode: 'deterministic', language: 'en', maxSpokenCharacters: 600 },
      playback: { volume: 0.85, interruptible: true, fallbackToDefaultDevice: true },
      agentOverrides: {},
    });
  });

  it.each([
    ['wake sensitivity', { activation: { wakePhrase: { sensitivity: 1.01 } } }],
    ['VAD sensitivity', { vad: { sensitivity: -0.01 } }],
    ['playback volume', { playback: { volume: 1.01 } }],
    ['TTS speed', { tts: { speed: 2.01 } }],
    ['calibration duration', { vad: { calibrationMs: 249 } }],
    ['minimum speech duration', { vad: { minimumSpeechMs: 2001 } }],
    ['silence duration', { vad: { silenceMs: 5001 } }],
    ['maximum utterance duration', { vad: { maximumUtteranceMs: 2999 } }],
    ['narrator length', { narrator: { maxSpokenCharacters: 119 } }],
  ])('rejects an out-of-range %s', (_label, patch) => {
    expect(() => parseFoolVoiceSettings(patch)).toThrow();
  });

  it('validates narrator timeout only for the openai-compatible mode', () => {
    expect(() =>
      parseFoolVoiceSettings({
        narrator: {
          mode: 'openai-compatible',
          language: 'tr',
          modelId: 'narrator',
          timeoutMs: 999,
          maxSpokenCharacters: 600,
        },
      })
    ).toThrow();
    expect(
      parseFoolVoiceSettings({
        narrator: {
          mode: 'deterministic',
          language: 'tr',
          maxSpokenCharacters: 600,
        },
      }).narrator.mode
    ).toBe('deterministic');
  });

  it('fills recognized missing fields from defaults and normalizes the wake phrase', () => {
    const settings = parseFoolVoiceSettings({
      activation: { wakePhrase: { phrase: '  hey   fool  ' } },
    });

    expect(settings.activation.wakePhrase.phrase).toBe('hey fool');
    expect(settings.vad).toEqual(DEFAULT_FOOL_VOICE_SETTINGS.vad);
  });

  it('rejects unknown and secret-shaped keys at every nested boundary', () => {
    expect(() => parseFoolVoiceSettings({ apiKey: 'secret' })).toThrow();
    expect(() =>
      parseFoolVoiceSettings({
        connections: { openAICompatible: { api_key: 'secret' } },
      })
    ).toThrow();
  });

  it('falls back as a whole and emits only a machine-safe diagnostic for invalid stored data', () => {
    const diagnostic = vi.fn();
    const settings = loadFoolVoiceSettings({ enabled: true, vad: { sensitivity: 4 } }, diagnostic);

    expect(settings).toEqual(DEFAULT_FOOL_VOICE_SETTINGS);
    expect(diagnostic).toHaveBeenCalledWith({ code: 'invalid-settings', key: 'fool.voice' });
  });

  it('gives a shortcut to a record written before the shortcut did anything', () => {
    // Every stored empty string predates the field being read, so it means
    // "never chosen" rather than "deliberately cleared".
    const settings = loadFoolVoiceSettings({ schemaVersion: 1, activation: { pushToTalkShortcut: '' } });

    expect(settings.activation.pushToTalkShortcut).toBe(PUSH_TO_TALK_DEFAULT);
    expect(settings.schemaVersion).toBe(FOOL_VOICE_SCHEMA_VERSION);
  });

  it('leaves a shortcut the user chose alone', () => {
    const settings = loadFoolVoiceSettings({ schemaVersion: 1, activation: { pushToTalkShortcut: 'Control+Alt+K' } });

    expect(settings.activation.pushToTalkShortcut).toBe('Control+Alt+K');
  });

  it('lets a shortcut cleared after the upgrade stay cleared', () => {
    const settings = loadFoolVoiceSettings({
      schemaVersion: FOOL_VOICE_SCHEMA_VERSION,
      activation: { pushToTalkShortcut: '' },
    });

    expect(settings.activation.pushToTalkShortcut).toBe('');
  });

  // The recording belongs to the user, not to the engine, so a record naming the
  // engine clones used to be rendered by is pointing at a voice that is still
  // there. Left alone it falls through to "that model has no voices" and the
  // reply is spoken by a stranger.
  it('moves a voice cloned on the old engine onto the one that renders them now', () => {
    const settings = loadFoolVoiceSettings({
      schemaVersion: 3,
      tts: { modelId: 'tts-zipvoice-distill-int8', profileId: 'cloned:ultron' },
    });

    expect(settings.tts.modelId).toBe(CLONING_MODEL_ID);
    expect(settings.tts.profileId).toBe('cloned:ultron');
  });

  it('leaves a preset voice on that engine alone, because it was a real choice', () => {
    const settings = loadFoolVoiceSettings({
      schemaVersion: 3,
      tts: { modelId: 'tts-zipvoice-distill-int8', profileId: 'speaker-0' },
    });

    expect(settings.tts.modelId).toBe('tts-zipvoice-distill-int8');
  });

  it('leaves a cloned voice on any other engine alone', () => {
    const settings = loadFoolVoiceSettings({
      schemaVersion: 3,
      tts: { modelId: 'tts-kokoro-en-v0_19-int8', profileId: 'cloned:ultron' },
    });

    expect(settings.tts.modelId).toBe('tts-kokoro-en-v0_19-int8');
  });
});

describe('Fool voice provider and model discriminants', () => {
  it('keeps default providers independent and does not advertise streaming', () => {
    expect(FOOL_VOICE_PROVIDERS).toEqual([
      {
        id: 'local-sherpa',
        kind: 'local',
        displayName: 'Local Sherpa',
        privacy: 'local',
        capabilities: ['transcribe', 'synthesize', 'manage-models'],
      },
      {
        id: 'local-audiocpp',
        kind: 'local',
        displayName: 'Local audio.cpp',
        privacy: 'local',
        capabilities: ['synthesize', 'manage-models', 'voice-cloning'],
      },
      {
        id: 'openai-compatible',
        kind: 'remote',
        displayName: 'OpenAI Compatible',
        privacy: 'network',
        capabilities: ['transcribe', 'synthesize'],
      },
      {
        id: 'transcript-wake-word',
        kind: 'derived',
        displayName: 'Transcript Wake Word',
        privacy: 'inherits-stt',
        capabilities: ['wake-word'],
      },
    ]);
    // Streaming synthesis stays unadvertised: neither audio.cpp model this app
    // ships supports it — both are offline-only — so the app still chunks a
    // passage into sentences itself.
    expect(FOOL_VOICE_PROVIDERS.flatMap(({ capabilities }) => capabilities)).not.toContain('stream-transcription');
    expect(FOOL_VOICE_PROVIDERS.flatMap(({ capabilities }) => capabilities)).not.toContain('stream-synthesis');
  });

  it('keeps every local provider private and every model it installs on this machine', () => {
    const local = FOOL_VOICE_PROVIDERS.filter((provider) => provider.kind === 'local');

    expect(local.map(({ id }) => id)).toEqual(['local-sherpa', 'local-audiocpp']);
    expect(local.every(({ privacy }) => privacy === 'local')).toBe(true);
    expect(local.every(({ capabilities }) => capabilities.includes('manage-models'))).toBe(true);
  });

  it('narrows managed models and cloned profiles by their public discriminants', () => {
    const model: VoiceModel = {
      id: 'stt-whisper-tiny-int8-v1',
      providerId: 'local-sherpa',
      displayName: 'Whisper Tiny',
      languages: ['tr'],
      distribution: 'managed',
      state: { status: 'not-installed' },
      downloadBytes: null,
      installedBytes: null,
      role: 'speech-to-text',
      audioInput: {
        container: 'wav',
        encoding: 'pcm16le',
        sampleRateHz: 16000,
        channels: 1,
      },
    };
    const profile: VoiceProfile = {
      id: 'clone-1',
      providerId: 'local-sherpa',
      modelId: 'tts-supertonic-3-int8-2026-05-11',
      kind: 'cloned',
      state: 'creating',
      displayName: 'Clone',
      languages: ['tr'],
      deletable: true,
    };

    expect(model.distribution === 'managed' ? model.state.status : 'unmanaged').toBe('not-installed');
    expect(profile.kind === 'cloned' ? profile.deletable : false).toBe(true);
  });
});

describe('Voice turn lifecycle', () => {
  it('supports both wake transcription and direct push-to-talk command paths', () => {
    expect(
      isVoiceTurnTransitionAllowed(
        state('wake-listening', { sessionId: 's1' }),
        state('transcribing', { sessionId: 's1', operationId: 'op1', purpose: 'wake' })
      )
    ).toBe(true);
    expect(
      isVoiceTurnTransitionAllowed(
        state('idle'),
        state('command-listening', { sessionId: 's2', clientTurnId: 'turn-2' })
      )
    ).toBe(true);
  });

  it('rejects jumps that bypass required phases', () => {
    expect(
      isVoiceTurnTransitionAllowed(
        state('idle'),
        state('speaking', {
          sessionId: 's1',
          conversationId: 'c1',
          turnId: 't1',
          operationId: 'op1',
        })
      )
    ).toBe(false);
  });

  it.each(['cancelled', 'error'] as const)('requires an explicit reset after terminal %s state', (status) => {
    const terminal =
      status === 'cancelled'
        ? state('transcribing', { sessionId: 's1', operationId: 'op1', purpose: 'wake' }, { status, reason: 'user' })
        : state(
            'transcribing',
            { sessionId: 's1', operationId: 'op1', purpose: 'wake' },
            { status, code: 'failed', recoverable: true }
          );

    expect(isVoiceTurnTransitionAllowed(terminal, state('wake-listening', { sessionId: 's2' }))).toBe(false);
    expect(isVoiceTurnTransitionAllowed(terminal, state('wake-listening', { sessionId: 's2' }), { reset: true })).toBe(
      true
    );
  });

  it('allows muted recovery only to idle or fresh wake listening', () => {
    const muted = state(
      'speaking',
      { sessionId: 's1', conversationId: 'c1', turnId: 't1', operationId: 'op1' },
      { status: 'muted', resetTarget: 'wake-listening' }
    );

    expect(
      isVoiceTurnTransitionAllowed(
        muted,
        state('speaking', {
          sessionId: 's1',
          conversationId: 'c1',
          turnId: 't1',
          operationId: 'op2',
        }),
        { reset: true }
      )
    ).toBe(false);
    expect(isVoiceTurnTransitionAllowed(muted, state('wake-listening', { sessionId: 's2' }), { reset: true })).toBe(
      true
    );
  });
});

describe('Voice download progress lifecycle', () => {
  const progress = (patch: Partial<VoiceDownloadProgress> = {}): VoiceDownloadProgress =>
    ({
      operationId: 'op1',
      providerId: 'local-sherpa',
      modelId: 'stt-whisper-tiny-int8-v1',
      sequence: 1,
      attempt: 1,
      downloadedBytes: 100,
      totalBytes: 1000,
      updatedAtMs: 1,
      state: 'downloading',
      ...patch,
    }) as VoiceDownloadProgress;

  it('tracks measured bytes without a stored percentage', () => {
    const current = progress();
    expect(current.downloadedBytes).toBe(100);
    expect(current).not.toHaveProperty('percentage');
  });

  it('allows byte progress to reset only when a new attempt begins', () => {
    expect(isVoiceDownloadProgressTransitionAllowed(progress(), progress({ sequence: 2, downloadedBytes: 0 }))).toBe(
      false
    );
    expect(
      isVoiceDownloadProgressTransitionAllowed(progress(), progress({ sequence: 2, attempt: 2, downloadedBytes: 0 }))
    ).toBe(true);
  });

  it('rejects progress after a terminal event', () => {
    expect(
      isVoiceDownloadProgressTransitionAllowed(
        progress({ state: 'cancelled' }),
        progress({ sequence: 2, state: 'downloading' })
      )
    ).toBe(false);
  });
});

/**
 * Which provider a request is addressed to.
 *
 * Every synthesis call site used to name `local-sherpa` outright, which was
 * true while sherpa was the only engine that spoke. It is not any more: a
 * request for a Chatterbox voice sent to sherpa is refused as an unknown model,
 * and the failure looks like a broken download rather than a misrouted call.
 */
describe('Routing a request to the provider that owns the model', () => {
  const models = [
    { id: 'tts-piper-en-libritts-r', providerId: 'local-sherpa' as const },
    { id: AUDIOCPP_POCKET_MODEL_ID, providerId: 'local-audiocpp' as const },
    { id: 'stt-phrase-v1', providerId: 'transcript-wake-word' as const },
  ];

  it('names the provider each model belongs to', () => {
    expect(synthesisProviderFor(models, 'tts-piper-en-libritts-r')).toBe('local-sherpa');
    expect(synthesisProviderFor(models, AUDIOCPP_POCKET_MODEL_ID)).toBe('local-audiocpp');
  });

  // The catalog is read asynchronously, so a call can be made against a model
  // list that has not arrived yet. Guessing sherpa there is what the code did
  // before this function existed, and is right far more often than it is wrong.
  it('falls back to sherpa for a model it cannot find', () => {
    expect(synthesisProviderFor(models, 'nothing-like-this')).toBe('local-sherpa');
    expect(synthesisProviderFor([], 'tts-piper-en-libritts-r')).toBe('local-sherpa');
  });

  // Wake-word matching runs on a transcript and has no engine to address.
  it('never routes synthesis to a provider that cannot speak', () => {
    expect(synthesisProviderFor(models, 'stt-phrase-v1')).toBe('local-sherpa');
  });

  // Installing and removing are the local providers' business alone: the remote
  // one has nothing on disk, so it must not be the answer even for its own model.
  it('names only a local provider for an install or a removal', () => {
    const withRemote = [...models, { id: 'tts-openai-1', providerId: 'openai-compatible' as const }];
    expect(localProviderFor(withRemote, AUDIOCPP_POCKET_MODEL_ID)).toBe('local-audiocpp');
    expect(localProviderFor(withRemote, 'tts-openai-1')).toBe('local-sherpa');
  });
});
