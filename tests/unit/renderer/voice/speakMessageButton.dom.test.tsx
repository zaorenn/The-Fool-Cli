/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings } from '@/common/types/foolVoice';
import SpeakMessageButton from '@renderer/components/chat/SpeakMessageButton';
import { getSpeechPlayer } from '@renderer/services/voice/speechPlayer';

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

// Models the real service's interruption token: a stop invalidates whatever a
// multi-clip answer was speaking under, which is how the clips still queued
// behind it get dropped.
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

const readyModel = (
  id: string,
  role: 'text-to-speech' | 'speech-to-text' = 'text-to-speech',
  // Empty models a cloning engine: it lists no voices of its own, only what
  // the user clones into it.
  profileIds: string[] = ['libritts-p0']
) => ({
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
  profileIds,
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
    play.mockReset();
    play.mockResolvedValue(undefined);
    stop.mockClear();
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

  it('falls back to an installed voice when a cloned reference has gone missing', async () => {
    // The model itself (Pocket) is installed either way — a cloned voice is a
    // recording, not a trained model, so "the model is installed" stays true
    // even after the specific recording it needs was deleted, or never copied
    // to this machine. That used to reach the native addon with nothing to
    // clone and crash the app; refusing it is correct, but left uncaught here
    // it read as "speak aloud" failing on an ordinary message.
    settings = {
      ...NO_SUMMARY,
      tts: { ...NO_SUMMARY.tts, modelId: 'tts-pocket-int8-2026-01-26', profileId: 'cloned:ultron' },
    };
    catalogInvoke.mockResolvedValue({
      ok: true,
      data: {
        models: [
          readyModel('tts-pocket-int8-2026-01-26', 'text-to-speech', []),
          readyModel('tts-kokoro-en-v0_19-int8'),
        ],
        profiles: [],
      },
    });

    render(<SpeakMessageButton text='Still speak, please.' />);
    fireEvent.click(screen.getByTestId('speak-message'));

    await waitFor(() => expect(synthesizeInvoke).toHaveBeenCalled());
    const request = synthesizeInvoke.mock.calls[0][0] as { payload: Record<string, unknown> };
    expect(request.payload.modelId).toBe('tts-kokoro-en-v0_19-int8');
    expect(request.payload.profileId).toBe('speaker-0');
  });

  it('falls back to speaker-0 on the same model when it is the only voice installed and its cloned reference is gone', async () => {
    // The coincidence this guards: the fallback model and the configured one
    // are the same string (Pocket is the only voice installed), which must
    // not be mistaken for "kept the configured profile".
    settings = {
      ...NO_SUMMARY,
      tts: { ...NO_SUMMARY.tts, modelId: 'tts-pocket-int8-2026-01-26', profileId: 'cloned:ultron' },
    };
    catalogInvoke.mockResolvedValue({
      ok: true,
      data: { models: [readyModel('tts-pocket-int8-2026-01-26', 'text-to-speech', [])], profiles: [] },
    });

    render(<SpeakMessageButton text='Still speak, please.' />);
    fireEvent.click(screen.getByTestId('speak-message'));

    await waitFor(() => expect(synthesizeInvoke).toHaveBeenCalled());
    const request = synthesizeInvoke.mock.calls[0][0] as { payload: Record<string, unknown> };
    expect(request.payload.profileId).toBe('speaker-0');
  });

  it('keeps a cloned profile whose recording is actually present', async () => {
    catalogInvoke.mockResolvedValue({
      ok: true,
      data: {
        models: [readyModel('tts-pocket-int8-2026-01-26', 'text-to-speech', [])],
        profiles: [
          {
            id: 'cloned:ultron',
            providerId: 'local-sherpa',
            modelId: 'tts-pocket-int8-2026-01-26',
            kind: 'cloned',
            state: 'ready',
            displayName: 'Ultron',
            languages: ['en'],
            deletable: true,
          },
        ],
      },
    });
    settings = {
      ...NO_SUMMARY,
      tts: { ...NO_SUMMARY.tts, modelId: 'tts-pocket-int8-2026-01-26', profileId: 'cloned:ultron' },
    };

    render(<SpeakMessageButton text='Ultron speaking.' />);
    fireEvent.click(screen.getByTestId('speak-message'));

    await waitFor(() => expect(synthesizeInvoke).toHaveBeenCalled());
    const request = synthesizeInvoke.mock.calls[0][0] as { payload: Record<string, unknown> };
    expect(request.payload).toMatchObject({ modelId: 'tts-pocket-int8-2026-01-26', profileId: 'cloned:ultron' });
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
    // Playback that never ends on its own, so the button is still in its
    // speaking state when the second press arrives. With a clip that resolves
    // immediately the press lands on an idle button and starts a second reading
    // instead, which is the opposite of what this is about.
    play.mockReturnValue(new Promise<void>(() => undefined));

    render(<SpeakMessageButton text='A long reply to read out.' />);
    fireEvent.click(screen.getByTestId('speak-message'));
    await waitFor(() => expect(play).toHaveBeenCalled());
    const stopsBefore = stop.mock.calls.length;

    fireEvent.click(screen.getByTestId('speak-message'));

    expect(stop.mock.calls.length).toBeGreaterThan(stopsBefore);
  });

  // A long reply is spoken as a run of clips, and the first one is short so
  // speech starts while the rest is still being rendered.
  it('renders a long reply in pieces rather than waiting for all of it', async () => {
    const passage = Array.from({ length: 20 }, (_, index) => `This is sentence number ${index}.`).join(' ');

    render(<SpeakMessageButton text={passage} />);
    fireEvent.click(screen.getByTestId('speak-message'));

    await waitFor(() => expect(play.mock.calls.length).toBeGreaterThan(1));
    const spoken = synthesizeInvoke.mock.calls.map((call) => (call[0] as { payload: { text: string } }).payload.text);
    expect(spoken.length).toBeGreaterThan(1);
    // Every word still gets said, in order.
    expect(spoken.join(' ')).toBe(passage);
  });

  // The clips behind an interrupted one belong to an answer the user has already
  // silenced; speaking them would be the interruption failing to take.
  it('drops the rest of the answer once playback is stopped', async () => {
    const passage = Array.from({ length: 20 }, (_, index) => `This is sentence number ${index}.`).join(' ');
    play.mockImplementationOnce(async () => {
      // Stopping from anywhere — here, a barge-in — ends the whole passage.
      getSpeechPlayer().stop();
    });

    render(<SpeakMessageButton text={passage} />);
    fireEvent.click(screen.getByTestId('speak-message'));

    await waitFor(() => expect(play).toHaveBeenCalled());
    // Long enough for the next clip to have been played had the stop not taken.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(play.mock.calls.length).toBe(1);
  });
});
