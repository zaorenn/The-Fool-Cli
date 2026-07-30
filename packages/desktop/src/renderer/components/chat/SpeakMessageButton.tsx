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
import { getSpeechPlayer, stopSpeech } from '@renderer/services/voice/speechPlayer';
import { speakText } from '@renderer/services/voice/speakText';

export type SpeakMessageButtonProps = {
  /** Raw message markdown; sanitised before it reaches the speech engine. */
  text: string;
};

const newRequestId = () => `speak-${crypto.randomUUID()}`;

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
  const operation = useRef<string | null>(null);

  useEffect(
    () => () => {
      stopSpeech();
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
    stopSpeech();
    setState('idle');
  }, []);

  const speak = useCallback(async () => {
    const outcome = await speakText({
      text,
      settings,
      playback: getSpeechPlayer(),
      maxSpokenCharacters: MAX_SPOKEN_CHARACTERS,
      onOperation: (operationId) => {
        operation.current = operationId;
      },
      onPlaybackStart: () => setState('speaking'),
    });

    // Silence with no explanation reads as a broken button, so say what is
    // missing instead.
    if (outcome.spoken === false && outcome.reason === 'no-voice') Message.info(t('messages.speakNeedsVoice'));
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
