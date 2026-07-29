/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
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

const setup = (installed = true) => {
  const onSelect = vi.fn();
  const onPreview = vi.fn().mockResolvedValue(undefined);
  const onInstall = vi.fn();

  render(
    <VoicePicker
      models={[model('kokoro', installed)]}
      profiles={[profile('af_bella', 'kokoro', 'Bella'), profile('am_adam', 'kokoro', 'Adam')]}
      selectedProfileId='af_bella'
      onSelect={onSelect}
      onPreview={onPreview}
      onInstall={onInstall}
    />
  );

  return { onSelect, onPreview, onInstall };
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
        onSelect={vi.fn()}
        onPreview={vi.fn()}
        onInstall={vi.fn()}
      />
    );

    expect(screen.queryByTestId('voice-group-empty')).toBeNull();
  });
});
