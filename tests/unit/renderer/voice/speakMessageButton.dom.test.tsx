/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings } from '@/common/types/foolVoice';
import SpeakMessageButton from '@renderer/components/chat/SpeakMessageButton';

const catalogInvoke = vi.fn();
const synthesizeInvoke = vi.fn();
const summaryPlanInvoke = vi.fn();
const summarizeInvoke = vi.fn();
const cancelInvoke = vi.fn().mockResolvedValue({ ok: true, data: {} });
const play = vi.fn().mockResolvedValue(undefined);
const stop = vi.fn();
const setOutputDevice = vi.fn();
const messageInfo = vi.fn();
const messageError = vi.fn();

/**
 * The English summary is switched off for these cases.
 *
 * It has its own tests; everything here is about which voice says what, and
 * leaving a model in the middle of that would only obscure it.
 */
const NO_SUMMARY: FoolVoiceSettings = {
  ...DEFAULT_FOOL_VOICE_SETTINGS,
  summary: { ...DEFAULT_FOOL_VOICE_SETTINGS.summary, translateToEnglish: false },
};

let settings: FoolVoiceSettings = NO_SUMMARY;

vi.mock('@/common', () => ({
  ipcBridge: {
    foolVoice: {
      catalog: { invoke: (request: unknown) => catalogInvoke(request) },
      synthesize: { invoke: (request: unknown) => synthesizeInvoke(request) },
      summaryPlan: { invoke: (request: unknown) => summaryPlanInvoke(request) },
      summarize: { invoke: (request: unknown) => summarizeInvoke(request) },
      cancel: { invoke: (request: unknown) => cancelInvoke(request) },
      stage: { emit: () => undefined },
    },
  },
}));

vi.mock('@renderer/hooks/voice/useFoolVoiceSettings', () => ({
  useFoolVoiceSettings: () => ({ settings, ready: true, update: vi.fn() }),
}));

vi.mock('@renderer/services/voice/AudioPlaybackService', () => ({
  AudioPlaybackService: class {
    public play = play;
    public stop = stop;
    public setOutputDevice = setOutputDevice;
  },
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Message: { info: (text: string) => messageInfo(text), error: (text: string) => messageError(text) },
}));

vi.mock('@icon-park/react', () => ({
  PauseOne: () => <span data-testid='pause-icon' />,
  VolumeNotice: () => <span data-testid='speak-icon' />,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const readyModel = (id: string, role: 'text-to-speech' | 'speech-to-text' = 'text-to-speech') => ({
  id,
  providerId: 'local-sherpa',
  displayName: id,
  languages: ['en'],
  role,
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

describe('SpeakMessageButton', () => {
  beforeEach(() => {
    settings = NO_SUMMARY;
    catalogInvoke.mockReset();
    synthesizeInvoke.mockReset();
    summaryPlanInvoke.mockReset();
    summarizeInvoke.mockReset();
    play.mockClear();
    setOutputDevice.mockClear();
    messageInfo.mockClear();
    messageError.mockClear();
    catalogInvoke.mockResolvedValue({ ok: true, data: { models: [readyModel('tts-piper-en-libritts-r')] } });
    synthesizeInvoke.mockResolvedValue(synthesis);
  });

  it('speaks the message with the voice and speaker the user configured', async () => {
    settings = {
      ...NO_SUMMARY,
      devices: { inputDeviceId: null, outputDeviceId: 'speaker-7' },
      tts: { ...NO_SUMMARY.tts, profileId: 'speaker-457', speed: 1.2 },
    };

    render(<SpeakMessageButton text='The tests pass.' />);
    fireEvent.click(screen.getByTestId('speak-message'));

    await waitFor(() => expect(synthesizeInvoke).toHaveBeenCalled());
    const request = synthesizeInvoke.mock.calls[0][0] as { payload: Record<string, unknown> };
    expect(request.payload).toMatchObject({
      modelId: 'tts-piper-en-libritts-r',
      profileId: 'speaker-457',
      speed: 1.2,
      text: 'The tests pass.',
    });
    // The chosen speaker, not just the system default.
    await waitFor(() => expect(setOutputDevice).toHaveBeenCalledWith('speaker-7'));
    await waitFor(() => expect(play).toHaveBeenCalled());
  });

  it('says what is missing instead of going silent when no voice is installed', async () => {
    catalogInvoke.mockResolvedValue({ ok: true, data: { models: [] } });

    render(<SpeakMessageButton text='Anything at all.' />);
    fireEvent.click(screen.getByTestId('speak-message'));

    await waitFor(() => expect(messageInfo).toHaveBeenCalledWith('messages.speakNeedsVoice'));
    expect(synthesizeInvoke).not.toHaveBeenCalled();
  });

  it('falls back to an installed voice when the configured model was removed', async () => {
    settings = {
      ...NO_SUMMARY,
      tts: { ...NO_SUMMARY.tts, modelId: 'tts-gone', profileId: 'ghost' },
    };
    catalogInvoke.mockResolvedValue({ ok: true, data: { models: [readyModel('tts-kokoro-en-v0_19-int8')] } });

    render(<SpeakMessageButton text='Still speak, please.' />);
    fireEvent.click(screen.getByTestId('speak-message'));

    await waitFor(() => expect(synthesizeInvoke).toHaveBeenCalled());
    const request = synthesizeInvoke.mock.calls[0][0] as { payload: Record<string, unknown> };
    expect(request.payload.modelId).toBe('tts-kokoro-en-v0_19-int8');
  });

  it('reports a synthesis failure rather than looking like a dead button', async () => {
    synthesizeInvoke.mockResolvedValue({ ok: false, error: { code: 'provider-failed' } });

    render(<SpeakMessageButton text='This will fail.' />);
    fireEvent.click(screen.getByTestId('speak-message'));

    await waitFor(() => expect(messageError).toHaveBeenCalledWith('messages.speakFailed'));
  });

  it('does nothing for a message with nothing speakable in it', async () => {
    render(<SpeakMessageButton text={'```\nconst x = 1;\n```'} />);
    fireEvent.click(screen.getByTestId('speak-message'));

    await waitFor(() => expect(catalogInvoke).not.toHaveBeenCalled());
    expect(synthesizeInvoke).not.toHaveBeenCalled();
  });

  it('speaks the English briefing rather than the Turkish reply when that is switched on', async () => {
    settings = DEFAULT_FOOL_VOICE_SETTINGS;
    summaryPlanInvoke.mockResolvedValue({
      ok: true,
      data: { modelId: 'qwen3-4b', displayName: 'qwen3-4b', loaded: true, local: true, origin: 'loaded' },
    });
    summarizeInvoke.mockResolvedValue({
      ok: true,
      data: { operationId: 'op', text: 'The tests pass.', modelId: 'qwen3-4b', source: 'model' },
    });

    render(<SpeakMessageButton text='Testler geçiyor, iki dosyayı değiştirdim.' />);
    fireEvent.click(screen.getByTestId('speak-message'));

    await waitFor(() => expect(synthesizeInvoke).toHaveBeenCalled());
    const request = synthesizeInvoke.mock.calls[0][0] as { payload: Record<string, unknown> };
    expect(request.payload.text).toBe('The tests pass.');
  });

  it('still reads the reply when no model could summarise it', async () => {
    settings = DEFAULT_FOOL_VOICE_SETTINGS;
    summaryPlanInvoke.mockResolvedValue({
      ok: true,
      data: { modelId: '', displayName: '', loaded: false, local: false, origin: 'none' },
    });

    render(<SpeakMessageButton text='Testler geçiyor.' />);
    fireEvent.click(screen.getByTestId('speak-message'));

    await waitFor(() => expect(synthesizeInvoke).toHaveBeenCalled());
    const request = synthesizeInvoke.mock.calls[0][0] as { payload: Record<string, unknown> };
    expect(request.payload.text).toBe('Testler geçiyor.');
  });

  it('stops playback when pressed while speaking', async () => {
    render(<SpeakMessageButton text='A long reply to read out.' />);
    fireEvent.click(screen.getByTestId('speak-message'));
    await waitFor(() => expect(play).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('speak-message'));

    expect(stop).toHaveBeenCalled();
  });
});
