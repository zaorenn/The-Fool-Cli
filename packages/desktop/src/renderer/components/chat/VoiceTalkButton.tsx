/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
import { Microphone, Voice } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useFoolVoiceSession } from '@renderer/hooks/voice/useFoolVoiceSession';

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
  const session = useFoolVoiceSession();
  const [starting, setStarting] = useState(false);

  const isTalking = session.state.phase !== 'idle';

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
      : t('conversation.chat.voice.startTalk');

  return (
    <Tooltip content={label} mini>
      <Button
        type='text'
        size='small'
        shape='circle'
        aria-label={label}
        disabled={disabled}
        loading={starting}
        onClick={handleClick}
        icon={isTalking ? <Voice theme='filled' size={18} /> : <Microphone theme='outline' size={18} />}
      />
    </Tooltip>
  );
};

export default VoiceTalkButton;
