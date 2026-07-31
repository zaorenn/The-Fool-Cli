/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings } from '@/common/types/foolVoice';

/**
 * Reading a reply aloud used to wait for `finish` — the whole answer, spoken
 * only once every word of it was already on screen. This is the hook that
 * should now start on the first complete sentence instead.
 */

const streamHandlers: Array<(message: unknown) => void> = [];
const emitStream = (message: unknown): void => streamHandlers.forEach((handler) => handler(message));

const catalogInvoke = vi.fn();
const synthesizeInvoke = vi.fn();
const play = vi.fn().mockResolvedValue(undefined);
const stop = vi.fn();
const setOutputDevice = vi.fn();

let settings: FoolVoiceSettings = {
  ...DEFAULT_FOOL_VOICE_SETTINGS,
  playback: { ...DEFAULT_FOOL_VOICE_SETTINGS.playback, autoReadAloud: true },
};

vi.mock('@/common', () => ({
  ipcBridge: {
    foolVoice: {
      catalog: { invoke: (request: unknown) => catalogInvoke(request) },
      synthesize: { invoke: (request: unknown) => synthesizeInvoke(request) },
      stage: { emit: () => undefined },
    },
    conversation: {
      responseStream: {
        on: (handler: (message: unknown) => void) => {
          streamHandlers.push(handler);
          return () => {
            const index = streamHandlers.indexOf(handler);
            if (index >= 0) streamHandlers.splice(index, 1);
          };
        },
      },
    },
  },
}));

vi.mock('@renderer/hooks/voice/useFoolVoiceSettings', () => ({
  useFoolVoiceSettings: () => ({ settings, ready: true, update: vi.fn() }),
}));

vi.mock('@renderer/hooks/voice/useFoolVoiceSession', () => ({
  isManualVoiceSessionActive: () => false,
  subscribeManualVoiceSession: () => () => undefined,
}));

vi.mock('@renderer/hooks/voice/useWakeWordListener', () => ({
  peekWakeListenerState: () => 'idle',
  subscribeWakeListener: () => () => undefined,
}));

// Models the real service's interruption token, same as speakMessageButton's test.
vi.mock('@renderer/services/voice/AudioPlaybackService', () => ({
  AudioPlaybackService: class {
    private generation = 0;
    public play = play;
    public setOutputDevice = setOutputDevice;
    public stop = (): void => {
      this.generation += 1;
      stop();
    };
    public currentGeneration = (): number => this.generation;
    public isCurrent = (generation: number): boolean => this.generation === generation;
  },
}));

const readyModel = (id: string) => ({
  id,
  providerId: 'local-sherpa',
  displayName: id,
  languages: ['en'],
  role: 'text-to-speech' as const,
  distribution: 'managed',
  state: { status: 'ready' },
  downloadBytes: null,
  installedBytes: null,
  audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 },
  profileIds: ['libritts-p0'],
});

const synthesis = {
  ok: true,
  data: {
    audio: {
      encoding: 'base64',
      mimeType: 'audio/wav',
      sampleRateHz: 22050,
      channels: 1,
      sampleFormat: 'pcm16le',
      byteLength: 128,
      dataBase64: 'AAAA',
    },
  },
};

const { useAutoReadAloud } = await import('@renderer/hooks/voice/useAutoReadAloud');

const textDelta = (content: string, overrides: Record<string, unknown> = {}) => ({
  type: 'text',
  conversation_id: 'c1',
  turn_id: 't1',
  msg_id: 'm1',
  data: content,
  ...overrides,
});

describe('useAutoReadAloud', () => {
  beforeEach(() => {
    streamHandlers.length = 0;
    settings = {
      ...DEFAULT_FOOL_VOICE_SETTINGS,
      playback: { ...DEFAULT_FOOL_VOICE_SETTINGS.playback, autoReadAloud: true },
    };
    catalogInvoke.mockReset();
    synthesizeInvoke.mockReset();
    play.mockClear();
    stop.mockClear();
    setOutputDevice.mockClear();
    catalogInvoke.mockResolvedValue({ ok: true, data: { models: [readyModel('tts-piper-en-libritts-r')] } });
    synthesizeInvoke.mockResolvedValue(synthesis);
  });

  it('starts speaking before the reply finishes', async () => {
    renderHook(() => useAutoReadAloud());

    emitStream(textDelta('First sentence. Still typing'));

    await waitFor(() => {
      expect(synthesizeInvoke).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.objectContaining({ text: 'First sentence.' }) })
      );
    });

    // No `finish` message has been sent — the point under test is that speech
    // did not wait for one.
    expect(synthesizeInvoke).toHaveBeenCalledTimes(1);
  });

  it('does nothing when auto-read-aloud is switched off', async () => {
    settings = {
      ...DEFAULT_FOOL_VOICE_SETTINGS,
      playback: { ...DEFAULT_FOOL_VOICE_SETTINGS.playback, autoReadAloud: false },
    };
    renderHook(() => useAutoReadAloud());

    emitStream(textDelta('First sentence. Still typing'));
    emitStream({ type: 'finish', conversation_id: 'c1', turn_id: 't1' });
    await Promise.resolve();

    expect(synthesizeInvoke).not.toHaveBeenCalled();
  });
});
