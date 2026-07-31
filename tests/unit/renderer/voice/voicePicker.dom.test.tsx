/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { VoiceModel, VoiceProfile } from '@/common/types/foolVoice';
import VoicePicker from '@renderer/components/settings/SettingsModal/contents/voice/VoicePicker';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const model = (id: string, installed: boolean): VoiceModel =>
  ({
    id,
    providerId: 'local-sherpa',
    displayName: id,
    languages: ['en'],
    role: 'text-to-speech',
    distribution: 'managed',
    state: installed ? { status: 'ready' } : { status: 'not-installed' },
    downloadBytes: null,
    installedBytes: null,
    audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 },
    profileIds: [],
  }) as VoiceModel;

const profile = (id: string, modelId: string, displayName: string): VoiceProfile => ({
  id,
  providerId: 'local-sherpa',
  modelId,
  kind: 'preset',
  state: 'ready',
  displayName,
  languages: ['en'],
  speakerId: 0,
  deletable: false,
});

const setup = (installed = true, overrides: Partial<React.ComponentProps<typeof VoicePicker>> = {}) => {
  const onSelect = vi.fn();
  const onPreview = vi.fn().mockResolvedValue(undefined);
  const onInstall = vi.fn();
  const onVerify = vi.fn();
  const onBrowseSpeakers = vi.fn();

  render(
    <VoicePicker
      models={[model('kokoro', installed)]}
      profiles={[profile('af_bella', 'kokoro', 'Bella'), profile('am_adam', 'kokoro', 'Adam')]}
      selectedProfileId='af_bella'
      selectedModelId='kokoro'
      installs={{}}
      verifications={{}}
      onSelect={onSelect}
      onPreview={onPreview}
      onInstall={onInstall}
      onVerify={onVerify}
      onBrowseSpeakers={onBrowseSpeakers}
      {...overrides}
    />
  );

  return { onSelect, onPreview, onInstall, onVerify, onBrowseSpeakers };
};

describe('VoicePicker', () => {
  it('shows each voice by name so none has to be typed', () => {
    setup();

    expect(screen.getByText('Bella')).toBeTruthy();
    expect(screen.getByText('Adam')).toBeTruthy();
  });

  it('selects a voice on click', () => {
    const { onSelect } = setup();

    fireEvent.click(screen.getByTestId('voice-option-am_adam'));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'am_adam' }));
  });

  it('selects a voice from the keyboard', () => {
    const { onSelect } = setup();

    fireEvent.keyDown(screen.getByTestId('voice-option-am_adam'), { key: 'Enter' });

    expect(onSelect).toHaveBeenCalled();
  });

  it('marks the current voice as pressed', () => {
    setup();

    expect(screen.getByTestId('voice-option-af_bella').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('voice-option-am_adam').getAttribute('aria-pressed')).toBe('false');
  });

  // A cloned voice is the user's recording, so it is offered against every
  // engine that can render it and wears the same id under each. Answering "is
  // this the selected one?" from the id alone lit both engines' cards at once,
  // and neither looked like the one that would actually speak.
  it('marks only the engine the selected voice belongs to', () => {
    render(
      <VoicePicker
        models={[model('pocket', true), model('zipvoice', true)]}
        profiles={[profile('cloned:ultron', 'pocket', 'Ultron'), profile('cloned:ultron', 'zipvoice', 'Ultron')]}
        selectedProfileId='cloned:ultron'
        selectedModelId='pocket'
        installs={{}}
        verifications={{}}
        onSelect={vi.fn()}
        onPreview={vi.fn()}
        onInstall={vi.fn()}
        onVerify={vi.fn()}
        onBrowseSpeakers={vi.fn()}
      />
    );

    const pressed = screen
      .getAllByTestId('voice-option-cloned:ultron')
      .map((card) => card.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['true', 'false']);
  });

  it('previews without also selecting', () => {
    const { onPreview, onSelect } = setup();

    fireEvent.click(screen.getByTestId('voice-preview-am_adam'));

    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'am_adam' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('offers an install action and refuses selection when the model is missing', () => {
    const { onInstall, onSelect } = setup(false);

    expect(screen.getByTestId('voice-model-install-kokoro')).toBeTruthy();

    fireEvent.click(screen.getByTestId('voice-option-af_bella'));
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('voice-model-install-kokoro'));
    expect(onInstall).toHaveBeenCalledWith('kokoro');
  });

  it('renders nothing for a model with no voices', () => {
    render(
      <VoicePicker
        models={[model('empty', true)]}
        profiles={[]}
        selectedProfileId=''
        selectedModelId=''
        installs={{}}
        verifications={{}}
        onSelect={vi.fn()}
        onPreview={vi.fn()}
        onInstall={vi.fn()}
        onVerify={vi.fn()}
        onBrowseSpeakers={vi.fn()}
      />
    );

    expect(screen.queryByTestId('voice-group-empty')).toBeNull();
  });

  it('cannot be pressed twice while a download is running', () => {
    const { onInstall } = setup(false, {
      installs: { kokoro: { phase: 'downloading', downloadedBytes: 5_242_880, totalBytes: 10_485_760 } },
    });

    const button = screen.getByTestId('voice-model-install-kokoro') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(button);
    expect(onInstall).not.toHaveBeenCalled();
  });

  it('shows how far a download has got, so an install does not look stalled', () => {
    setup(false, {
      installs: { kokoro: { phase: 'downloading', downloadedBytes: 5_242_880, totalBytes: 10_485_760 } },
    });

    expect(screen.getByTestId('voice-model-install-kokoro').textContent).toContain('50%');
    expect(screen.getByTestId('voice-model-install-kokoro').textContent).toContain('5/10MB');
  });

  it('offers a retry after a failed download instead of spinning for ever', () => {
    const { onInstall } = setup(false, {
      installs: { kokoro: { phase: 'failed', downloadedBytes: 0, totalBytes: null, errorCode: 'network' } },
    });

    const button = screen.getByTestId('voice-model-install-kokoro') as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    expect(onInstall).toHaveBeenCalledWith('kokoro');
  });

  it('checks a model on request and reports what the check found', () => {
    const { onVerify } = setup(true, { verifications: { kokoro: 'usable' } });

    expect(screen.getByTestId('voice-ok-kokoro')).toBeTruthy();

    fireEvent.click(screen.getByTestId('voice-model-verify-kokoro'));
    expect(onVerify).toHaveBeenCalledWith('kokoro');
  });

  it('says plainly when a check finds the model unusable', () => {
    setup(true, { verifications: { kokoro: 'unusable' } });

    expect(screen.getByTestId('voice-bad-kokoro')).toBeTruthy();
  });

  it('points at the full voice list for a model that carries more than one', () => {
    const { onBrowseSpeakers } = setup();

    fireEvent.click(screen.getByTestId('voice-model-hint-kokoro'));
    expect(onBrowseSpeakers).toHaveBeenCalledWith('kokoro');

    fireEvent.click(screen.getByTestId('voice-browse-kokoro'));
    expect(onBrowseSpeakers).toHaveBeenCalledTimes(2);
  });
});
