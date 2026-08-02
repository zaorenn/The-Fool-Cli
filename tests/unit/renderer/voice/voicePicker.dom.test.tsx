/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { VoiceModel, VoiceProfile } from '@/common/types/foolVoice';
import VoicePicker from '@renderer/components/settings/SettingsModal/contents/voice/tts/VoicePicker';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

/**
 * `profileIds` are the model's own presets, and the picker reads them to decide
 * whether there is a speaker list worth browsing. A fixture that left them empty
 * while rendering two preset cards described a catalog row that cannot exist —
 * the real catalog lists every preset it ships.
 */
const model = (id: string, installed: boolean, profileIds: string[] = ['af_bella', 'am_adam']): VoiceModel =>
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
    profileIds,
  }) as VoiceModel;

/** An engine that can only ever speak in a voice the user cloned. */
const cloningModel = (id: string, installed: boolean): VoiceModel =>
  ({ ...model(id, installed, []), requiresClonedVoice: true }) as VoiceModel;

const profile = (
  id: string,
  modelId: string,
  displayName: string,
  overrides: Partial<VoiceProfile> = {}
): VoiceProfile => ({
  id,
  providerId: 'local-sherpa',
  modelId,
  kind: 'preset',
  state: 'ready',
  displayName,
  languages: ['en'],
  speakerId: 0,
  deletable: false,
  ...overrides,
});

const setup = (installed = true, overrides: Partial<React.ComponentProps<typeof VoicePicker>> = {}) => {
  const onSelect = vi.fn();
  const onPreview = vi.fn().mockResolvedValue(undefined);
  const onInstall = vi.fn();
  const onVerify = vi.fn();
  const onBrowseSpeakers = vi.fn();
  const onDelete = vi.fn();

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
      onDelete={onDelete}
      {...overrides}
    />
  );

  return { onSelect, onPreview, onInstall, onVerify, onBrowseSpeakers, onDelete };
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
        onDelete={vi.fn()}
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

  it('offers deletion only for a voice that is deletable', () => {
    render(
      <VoicePicker
        models={[model('pocket', true)]}
        profiles={[
          profile('cloned:ultron', 'pocket', 'Ultron', { kind: 'cloned', deletable: true }),
          profile('af_bella', 'pocket', 'Bella'),
        ]}
        selectedProfileId='cloned:ultron'
        selectedModelId='pocket'
        installs={{}}
        verifications={{}}
        onSelect={vi.fn()}
        onPreview={vi.fn()}
        onInstall={vi.fn()}
        onVerify={vi.fn()}
        onBrowseSpeakers={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByTestId('voice-delete-cloned:ultron')).toBeTruthy();
    expect(screen.queryByTestId('voice-delete-af_bella')).toBeNull();
  });

  it('asks for confirmation before deleting, and does not select the card in the process', () => {
    const onDelete = vi.fn();
    const onSelect = vi.fn();
    render(
      <VoicePicker
        models={[model('pocket', true)]}
        profiles={[profile('cloned:ultron', 'pocket', 'Ultron', { kind: 'cloned', deletable: true })]}
        selectedProfileId=''
        selectedModelId=''
        installs={{}}
        verifications={{}}
        onSelect={onSelect}
        onPreview={vi.fn()}
        onInstall={vi.fn()}
        onVerify={vi.fn()}
        onBrowseSpeakers={vi.fn()}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByTestId('voice-delete-cloned:ultron'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('common.confirm'));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'cloned:ultron' }));
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
        onDelete={vi.fn()}
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

/**
 * Chatterbox and IndexTTS2 have no voice of their own: their loaders accept only
 * a cloning session. Until the user clones something they have no profiles at
 * all, and the picker used to skip any model with no profiles — which hid the
 * Install button along with the empty list, leaving a voice the app advertises
 * with no way on screen to obtain it.
 */
describe('VoicePicker with an engine that speaks only in a cloned voice', () => {
  const renderCloning = (installed: boolean, profiles: VoiceProfile[] = []) => {
    const onInstall = vi.fn();
    const onBrowseSpeakers = vi.fn();
    render(
      <VoicePicker
        models={[cloningModel('tts-audiocpp-pocket', installed)]}
        profiles={profiles}
        selectedProfileId=''
        selectedModelId=''
        installs={{}}
        verifications={{}}
        onSelect={vi.fn()}
        onPreview={vi.fn().mockResolvedValue(undefined)}
        onInstall={onInstall}
        onVerify={vi.fn()}
        onBrowseSpeakers={onBrowseSpeakers}
        onDelete={vi.fn()}
      />
    );
    return { onInstall, onBrowseSpeakers };
  };

  it('can still be installed when it has no voices to list', () => {
    const { onInstall } = renderCloning(false);

    fireEvent.click(screen.getByTestId('voice-model-install-tts-audiocpp-pocket'));
    expect(onInstall).toHaveBeenCalledWith('tts-audiocpp-pocket');
  });

  it('says why it is silent rather than looking broken', () => {
    renderCloning(true);

    expect(screen.getByTestId('voice-needs-clone-tts-audiocpp-pocket')).toBeTruthy();
  });

  // Two cloned voices are two cards, but there is no speaker list behind them —
  // and this provider has no route to ask for one, so the request 404s.
  it('never offers to browse speakers it does not have', () => {
    renderCloning(true, [
      profile('cloned:one', 'tts-audiocpp-pocket', 'One', { kind: 'cloned', deletable: true }),
      profile('cloned:two', 'tts-audiocpp-pocket', 'Two', { kind: 'cloned', deletable: true }),
    ]);

    expect(screen.queryByTestId('voice-browse-tts-audiocpp-pocket')).toBeNull();
    expect(screen.queryByTestId('voice-model-hint-tts-audiocpp-pocket')).toBeNull();
  });
});
