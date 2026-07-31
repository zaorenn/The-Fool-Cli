/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
import { Voice, VoiceOff } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useFoolVoiceSettings } from '@renderer/hooks/voice/useFoolVoiceSettings';
import { peekWakeListenerState, subscribeWakeListener } from '@renderer/hooks/voice/useWakeWordListener';

export type WakeListeningButtonProps = {
  disabled?: boolean;
};

/**
 * Whether the wake phrase is being listened for at all.
 *
 * Switched off, the listener closes capture rather than merely ignoring what it
 * hears: no microphone held open, no detector running, nothing published thirty
 * times a second. The desktop pet can stay on screen — being up is no longer
 * the same statement as holding the microphone.
 *
 * Next to the microphone because that is where the user notices they are being
 * listened to, and an always-on microphone should be switchable off from where
 * they are rather than from inside a settings modal.
 */
const WakeListeningButton: React.FC<WakeListeningButtonProps> = ({ disabled }) => {
  const { t } = useTranslation();
  const { settings, update } = useFoolVoiceSettings();
  const [wake, setWake] = useState(peekWakeListenerState);

  // The listener reports what it is actually doing, which is not always what the
  // setting asks for — a missing model or a refused microphone leaves it off.
  useEffect(() => subscribeWakeListener(setWake), []);

  const enabled = settings.activation.wakePhrase.enabled;

  const toggle = useCallback(() => {
    update((previous) => ({
      ...previous,
      activation: {
        ...previous.activation,
        wakePhrase: { ...previous.activation.wakePhrase, enabled: !previous.activation.wakePhrase.enabled },
      },
    }));
  }, [update]);

  const listening = enabled && wake !== 'off';
  const label = enabled
    ? t('conversation.chat.voice.wakeListeningOn', { phrase: settings.activation.wakePhrase.phrase })
    : t('conversation.chat.voice.wakeListeningOff');

  return (
    <Tooltip content={label} mini>
      <Button
        type='text'
        size='small'
        shape='circle'
        aria-label={label}
        aria-pressed={enabled}
        data-testid='voice-wake-listening'
        data-enabled={enabled ? 'true' : 'false'}
        data-listening={listening ? 'true' : undefined}
        disabled={disabled}
        onClick={toggle}
        className={listening ? 'text-primary' : 'text-t-tertiary'}
        icon={enabled ? <Voice theme='filled' size={18} /> : <VoiceOff theme='outline' size={18} />}
      />
    </Tooltip>
  );
};

export default WakeListeningButton;
