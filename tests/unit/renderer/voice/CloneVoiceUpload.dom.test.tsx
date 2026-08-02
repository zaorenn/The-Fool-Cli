/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const decodeAudioFileForCloningMock = vi.fn();
const transcribeInvoke = vi.fn();
const cloneVoiceInvoke = vi.fn();
const verifyVoiceModelMock = vi.fn();
const messageError = vi.fn();

vi.mock('@renderer/services/voice/decodeAudioFileForCloning', () => ({
  decodeAudioFileForCloning: (...args: unknown[]) => decodeAudioFileForCloningMock(...args),
}));

vi.mock('@renderer/services/voice/MicrophoneCapture', () => ({
  toBase64: () => 'ZmFrZQ==',
}));

// A relative specifier here would resolve against this test file's own
// directory, not the component's — silently mocking nothing and leaving the
// component's real import (and the real, unmocked `synthesize` IPC call
// inside it) to run instead. The alias path resolves to the same file
// regardless of which file's perspective it is written from.
vi.mock('@renderer/components/settings/SettingsModal/contents/voice/tts/voiceModelActions', () => ({
  verifyVoiceModel: (...args: unknown[]) => verifyVoiceModelMock(...args),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    foolVoice: {
      transcribe: { invoke: (request: unknown) => transcribeInvoke(request) },
      cloneVoice: { invoke: (request: unknown) => cloneVoiceInvoke(request) },
    },
  },
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick, disabled, loading }: React.ComponentProps<'button'> & { loading?: boolean }) => (
    <button onClick={onClick} disabled={disabled || loading}>
      {children}
    </button>
  ),
  Input: Object.assign(
    ({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) => (
      <input aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    ),
    {
      TextArea: ({
        value,
        onChange,
        placeholder,
      }: {
        value: string;
        onChange: (value: string) => void;
        placeholder?: string;
      }) => <textarea aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />,
    }
  ),
  Message: { error: (text: string) => messageError(text) },
  Spin: () => <span data-testid='spin' />,
  // A minimal stand-in that skips Arco's real drag/drop chrome: what this test
  // exercises is the component's own decode → transcribe → review → save →
  // verify pipeline, not Arco's drop-zone DOM.
  Upload: ({
    customRequest,
    disabled,
  }: {
    customRequest: (options: { file: File; onSuccess: () => void; onError: (error: unknown) => void }) => void;
    disabled?: boolean;
  }) => (
    <input
      type='file'
      data-testid='file-input'
      disabled={disabled}
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        customRequest({ file, onSuccess: () => {}, onError: () => {} });
      }}
    />
  ),
}));

vi.mock('@icon-park/react', () => ({
  Check: () => <span />,
  CloseOne: () => <span />,
  Microphone: () => <span />,
}));

import CloneVoiceUpload from '@renderer/components/settings/SettingsModal/contents/voice/tts/CloneVoiceUpload';

const sttModel = {
  id: 'stt-whisper-turbo',
  role: 'speech-to-text' as const,
  state: { status: 'ready' as const },
};
const pocketModel = {
  id: 'tts-pocket-int8-2026-01-26',
  role: 'text-to-speech' as const,
  state: { status: 'ready' as const },
  profileIds: [],
};

const dropFile = (name = 'ultron-clip.wav') => {
  const input = screen.getByTestId('file-input') as HTMLInputElement;
  const file = new File(['fake-audio-bytes'], name, { type: 'audio/wav' });
  Object.defineProperty(input, 'files', { value: [file] });
  fireEvent.change(input);
};

describe('CloneVoiceUpload', () => {
  beforeEach(() => {
    decodeAudioFileForCloningMock.mockReset();
    transcribeInvoke.mockReset();
    cloneVoiceInvoke.mockReset();
    verifyVoiceModelMock.mockReset();
    messageError.mockClear();

    decodeAudioFileForCloningMock.mockResolvedValue({
      wav: new ArrayBuffer(8),
      samples: new Float32Array(4),
      sampleRateHz: 24000,
      durationSec: 4,
    });
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'How is humanity saved.' } });
    cloneVoiceInvoke.mockResolvedValue({ ok: true, data: { profileId: 'cloned:ultron-clip' } });
    verifyVoiceModelMock.mockResolvedValue({ status: 'usable' });
  });

  it('transcribes the dropped file and shows it for review before saving anything', async () => {
    render(<CloneVoiceUpload models={[sttModel, pocketModel]} onSaved={vi.fn()} />);

    dropFile();

    await waitFor(() => expect(screen.getByTestId('clone-voice-review')).toBeInTheDocument());
    expect(screen.getByDisplayValue('How is humanity saved.')).toBeInTheDocument();
    expect(cloneVoiceInvoke).not.toHaveBeenCalled();
  });

  it('skips transcription entirely when no speech-to-text model is installed', async () => {
    render(<CloneVoiceUpload models={[pocketModel]} onSaved={vi.fn()} />);

    dropFile();

    await waitFor(() => expect(screen.getByTestId('clone-voice-review')).toBeInTheDocument());
    expect(transcribeInvoke).not.toHaveBeenCalled();
  });

  it('saves the reviewed voice, verifies it, and reports success', async () => {
    const onSaved = vi.fn();
    render(<CloneVoiceUpload models={[sttModel, pocketModel]} onSaved={onSaved} />);

    dropFile();
    await waitFor(() => expect(screen.getByTestId('clone-voice-review')).toBeInTheDocument());

    fireEvent.click(screen.getByText('settings.voice.cloneSaveAndVerify'));

    await waitFor(() => expect(screen.getByTestId('clone-voice-done')).toBeInTheDocument());
    expect(onSaved).toHaveBeenCalled();
    expect(verifyVoiceModelMock).toHaveBeenCalledWith(pocketModel, 'cloned:ultron-clip');
    expect(cloneVoiceInvoke).toHaveBeenCalledTimes(1);
    const [[request]] = cloneVoiceInvoke.mock.calls;
    expect(request.payload).toMatchObject({ referenceText: 'How is humanity saved.', audio: { sampleRateHz: 24000 } });
  });

  it('reports the voice as unusable when verification fails, without hiding that it was still saved', async () => {
    verifyVoiceModelMock.mockResolvedValue({ status: 'unusable' });
    render(<CloneVoiceUpload models={[sttModel, pocketModel]} onSaved={vi.fn()} />);

    dropFile();
    await waitFor(() => expect(screen.getByTestId('clone-voice-review')).toBeInTheDocument());
    fireEvent.click(screen.getByText('settings.voice.cloneSaveAndVerify'));

    await waitFor(() => expect(screen.getByTestId('clone-voice-done')).toBeInTheDocument());
    expect(screen.getByText('settings.voice.cloneSavedUnusable')).toBeInTheDocument();
  });

  it('reports a decode failure instead of leaving the drop zone looking dead', async () => {
    decodeAudioFileForCloningMock.mockRejectedValue(new Error('unsupported file'));
    render(<CloneVoiceUpload models={[sttModel, pocketModel]} onSaved={vi.fn()} />);

    dropFile();

    await waitFor(() => expect(messageError).toHaveBeenCalledWith('settings.voice.cloneDecodeFailed'));
    expect(screen.getByTestId('file-input')).not.toBeDisabled();
  });
});

/**
 * Three engines can render a cloned voice now, not one. The recording is offered
 * to all of them, so what this component still has to choose is which engine the
 * "Save & Verify" check speaks through — and whether a transcript is worth
 * insisting on at all.
 */
describe('CloneVoiceUpload across several cloning engines', () => {
  const chatterbox = {
    id: 'tts-audiocpp-pocket',
    role: 'text-to-speech' as const,
    state: { status: 'ready' as const },
    profileIds: [],
    requiresClonedVoice: true as const,
  };

  beforeEach(() => {
    decodeAudioFileForCloningMock.mockReset();
    transcribeInvoke.mockReset();
    cloneVoiceInvoke.mockReset();
    verifyVoiceModelMock.mockReset();
    messageError.mockClear();

    decodeAudioFileForCloningMock.mockResolvedValue({
      wav: new ArrayBuffer(8),
      samples: new Float32Array(4),
      sampleRateHz: 24000,
      durationSec: 4,
    });
    cloneVoiceInvoke.mockResolvedValue({ ok: true, data: { profileId: 'cloned:ultron-clip' } });
    verifyVoiceModelMock.mockResolvedValue({ status: 'usable' });
  });

  it('proves the clone on the engine that is about to speak it', async () => {
    render(
      <CloneVoiceUpload models={[pocketModel, chatterbox]} preferredModelId='tts-audiocpp-pocket' onSaved={vi.fn()} />
    );

    dropFile();
    await waitFor(() => expect(screen.getByTestId('clone-voice-review')).toBeInTheDocument());
    fireEvent.click(screen.getByText('settings.voice.cloneSaveAndVerify'));

    await waitFor(() => expect(screen.getByTestId('clone-voice-done')).toBeInTheDocument());
    expect(verifyVoiceModelMock).toHaveBeenCalledWith(chatterbox, 'cloned:ultron-clip');
  });

  // The selected voice is a Piper preset, which cannot clone. Verification still
  // has to happen on something, and any installed cloning engine will do.
  it('falls back to an installed cloning engine when the selected voice cannot clone', async () => {
    render(<CloneVoiceUpload models={[pocketModel, chatterbox]} preferredModelId='tts-piper-en' onSaved={vi.fn()} />);

    dropFile();
    await waitFor(() => expect(screen.getByTestId('clone-voice-review')).toBeInTheDocument());
    fireEvent.click(screen.getByText('settings.voice.cloneSaveAndVerify'));

    await waitFor(() => expect(screen.getByTestId('clone-voice-done')).toBeInTheDocument());
    expect(verifyVoiceModelMock).toHaveBeenCalledWith(pocketModel, 'cloned:ultron-clip');
  });

  /**
   * None of the three engines a clone is offered to reads a transcript — they
   * build a speaker embedding from the audio alone. Requiring one asked the user
   * to type something nothing would look at, and on a machine with no
   * transcription model installed it made cloning impossible without typing the
   * clip out by hand.
   */
  it('saves a voice with no transcript at all', async () => {
    render(<CloneVoiceUpload models={[chatterbox]} onSaved={vi.fn()} />);

    dropFile();
    await waitFor(() => expect(screen.getByTestId('clone-voice-review')).toBeInTheDocument());

    const save = screen.getByText('settings.voice.cloneSaveAndVerify') as HTMLButtonElement;
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    await waitFor(() => expect(screen.getByTestId('clone-voice-done')).toBeInTheDocument());
    const [[request]] = cloneVoiceInvoke.mock.calls;
    expect(request.payload.referenceText).toBe('');
  });

  // Saved is saved. With no engine on disk there is nothing to prove it on, which
  // is a different answer from "it does not work" — the recording is there and
  // speaks the moment an engine arrives.
  it('does not call a saved voice broken merely because no engine is installed', async () => {
    render(
      <CloneVoiceUpload models={[{ ...chatterbox, state: { status: 'not-installed' as const } }]} onSaved={vi.fn()} />
    );

    dropFile();
    await waitFor(() => expect(screen.getByTestId('clone-voice-review')).toBeInTheDocument());
    fireEvent.click(screen.getByText('settings.voice.cloneSaveAndVerify'));

    await waitFor(() => expect(screen.getByTestId('clone-voice-done')).toBeInTheDocument());
    expect(verifyVoiceModelMock).not.toHaveBeenCalled();
    expect(screen.getByText('settings.voice.cloneSavedNoEngine')).toBeInTheDocument();
  });
});
