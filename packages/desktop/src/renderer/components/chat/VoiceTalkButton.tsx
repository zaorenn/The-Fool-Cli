/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
import { Microphone, Voice } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useFoolVoiceSession } from '@renderer/hooks/voice/useFoolVoiceSession';
import { useFoolVoiceSettings } from '@renderer/hooks/voice/useFoolVoiceSettings';
import {
  peekWakeListenerState,
  subscribeWakeListener,
  type WakeListenerState,
} from '@renderer/hooks/voice/useWakeWordListener';

export type VoiceTalkButtonProps = {
  disabled?: boolean;
  /** Opens the Voice settings install flow when a required model is missing. */
  onRequestModelInstall?: (modelId: string) => void;
};

/**
 * Starts and stops hands-free conversation.
 *
 * Always rendered, because voice is a built-in capability rather than an
 * optional tool. It is never a dead control: with no speech model installed a
 * click routes to the install flow and says which model is missing.
 */
const VoiceTalkButton: React.FC<VoiceTalkButtonProps> = ({ disabled, onRequestModelInstall }) => {
  const { t } = useTranslation();
  // The stored settings, so the microphone, speaker and voice chosen in Voice
  // settings are the ones this button uses.
  const { settings } = useFoolVoiceSettings();
  const session = useFoolVoiceSession(settings);
  const [starting, setStarting] = useState(false);
  const [wake, setWake] = useState<WakeListenerState>(peekWakeListenerState);

  // The always-on listener runs elsewhere; showing its state here is what stops
  // an open microphone from being invisible.
  useEffect(() => subscribeWakeListener(setWake), []);

  const isTalking = session.state.phase !== 'idle';
  const isWakeArmed = !isTalking && wake !== 'off';

  const handleClick = useCallback(() => {
    if (session.missingModelId) {
      onRequestModelInstall?.(session.missingModelId);
      return;
    }
    if (isTalking) {
      session.stop();
      return;
    }

    setStarting(true);
    void session
      .start()
      .catch(() => session.stop())
      .finally(() => setStarting(false));
  }, [isTalking, onRequestModelInstall, session]);

  const label = session.missingModelId
    ? t('conversation.chat.voice.installNeeded')
    : isTalking
      ? t('conversation.chat.voice.stopTalk')
      : isWakeArmed
        ? t('conversation.chat.voice.wakeArmed', { phrase: settings.activation.wakePhrase.phrase })
        : t('conversation.chat.voice.startTalk');

  return (
    <Tooltip content={label} mini>
      <Button
        type='text'
        size='small'
        shape='circle'
        aria-label={label}
        data-testid='voice-talk'
        data-wake={isWakeArmed ? wake : undefined}
        disabled={disabled}
        loading={starting}
        onClick={handleClick}
        // Tinted while the wake listener holds the microphone, so "it is
        // listening" is visible without a second control.
        className={isWakeArmed ? 'text-primary' : undefined}
        icon={isTalking || isWakeArmed ? <Voice theme='filled' size={18} /> : <Microphone theme='outline' size={18} />}
      />
    </Tooltip>
  );
};

export default VoiceTalkButton;
