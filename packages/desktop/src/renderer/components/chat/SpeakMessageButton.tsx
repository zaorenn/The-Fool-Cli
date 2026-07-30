/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Message, Tooltip } from '@arco-design/web-react';
import { PauseOne, VolumeNotice } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { useFoolVoiceSettings } from '@renderer/hooks/voice/useFoolVoiceSettings';
import { AudioPlaybackService } from '@renderer/services/voice/AudioPlaybackService';
import { summarizeForSpeech } from '@renderer/services/voice/narration/englishSummary';
import { selectTtsTarget } from '@renderer/services/voice/selectTtsTarget';

export type SpeakMessageButtonProps = {
  /** Raw message markdown; sanitised before it reaches the speech engine. */
  text: string;
};

const newRequestId = () => `speak-${crypto.randomUUID()}`;

const unwrap = <T,>(envelope: { ok: true; data: T } | { ok: false; error: { code: string } }): T => {
  if (envelope.ok === false) throw new Error(envelope.error.code);
  return envelope.data;
};

/** Longest passage read from a single message, so one click cannot run for minutes. */
const MAX_SPOKEN_CHARACTERS = 1200;

/**
 * Reads a message aloud with the voice configured in Voice settings.
 *
 * The text is run through the narration sanitiser first, so code blocks, diffs,
 * file paths and secrets are never spoken even when the message is mostly code.
 * With the English summary switched on it is then translated and shortened, which
 * is what makes a long Turkish answer listenable through an English voice.
 */
const SpeakMessageButton: React.FC<SpeakMessageButtonProps> = ({ text }) => {
  const { t } = useTranslation();
  const { settings } = useFoolVoiceSettings();
  const [state, setState] = useState<'idle' | 'loading' | 'speaking'>('idle');
  const playback = useRef<AudioPlaybackService | null>(null);
  const operation = useRef<string | null>(null);

  useEffect(
    () => () => {
      playback.current?.stop();
      const id = operation.current;
      if (id) {
        void ipcBridge.foolVoice.cancel
          .invoke({ version: 1, requestId: newRequestId(), payload: { operationId: id } })
          .catch((): void => undefined);
      }
    },
    []
  );

  const stop = useCallback(() => {
    playback.current?.stop();
    setState('idle');
  }, []);

  const speak = useCallback(async () => {
    const { text: spoken } = await summarizeForSpeech(text, settings, MAX_SPOKEN_CHARACTERS);
    if (spoken.length === 0) return;

    const catalog = unwrap(
      await ipcBridge.foolVoice.catalog.invoke({
        version: 1,
        requestId: newRequestId(),
        payload: { includeProfiles: false },
      })
    );
    const installed = catalog.models
      .filter((model) => model.role === 'text-to-speech' && model.state.status === 'ready')
      .map((model) => model.id);

    // Silence with no explanation reads as a broken button, so say what is
    // missing instead.
    if (installed.length === 0) {
      Message.info(t('messages.speakNeedsVoice'));
      return;
    }

    const target = selectTtsTarget(spoken, settings, installed);
    // Fall back to something installed rather than failing on a voice the user
    // selected and then removed.
    const modelId = installed.includes(target.modelId) ? target.modelId : installed[0];
    const profileId = modelId === target.modelId ? target.profileId : 'speaker-0';

    const operationId = newRequestId();
    operation.current = operationId;

    const synthesis = unwrap(
      await ipcBridge.foolVoice.synthesize.invoke({
        version: 1,
        requestId: operationId,
        payload: {
          operationId,
          providerId: settings.tts.providerId,
          modelId,
          profileId,
          language: target.language,
          speed: settings.tts.speed,
          text: spoken,
        },
      })
    );

    playback.current ??= new AudioPlaybackService();
    playback.current.setOutputDevice(settings.devices.outputDeviceId);

    setState('speaking');
    await playback.current.play(synthesis.audio);
  }, [settings, t, text]);

  const handleClick = useCallback(() => {
    if (state === 'speaking') {
      stop();
      return;
    }
    if (state === 'loading') return;

    setState('loading');
    void speak()
      .catch((): void => {
        Message.error(t('messages.speakFailed'));
      })
      .finally(() => {
        operation.current = null;
        setState('idle');
      });
  }, [speak, state, stop, t]);

  const label = state === 'speaking' ? t('messages.speakStop') : t('messages.speakAloud');

  return (
    <Tooltip content={label} mini>
      <Button
        type='text'
        size='mini'
        shape='circle'
        aria-label={label}
        data-testid='speak-message'
        loading={state === 'loading'}
        onClick={handleClick}
        className='opacity-0 group-hover:opacity-100 transition-opacity'
        icon={
          state === 'speaking' ? <PauseOne theme='outline' size='14' /> : <VolumeNotice theme='outline' size='14' />
        }
      />
    </Tooltip>
  );
};

export default SpeakMessageButton;
