/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
import { VolumeMute, VolumeNotice } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useFoolVoiceSettings } from '@renderer/hooks/voice/useFoolVoiceSettings';

export type AutoReadAloudButtonProps = {
  disabled?: boolean;
};

/**
 * Whether replies get read aloud without being asked.
 *
 * Next to the microphone because the two are one thought — talking to the app
 * and being talked back to — and because a setting that changes whether your
 * machine starts speaking should be switchable from where you are, not from
 * three levels into a settings modal. Filled icon and accent colour when on,
 * outline and muted when off, so its state is legible without the tooltip.
 */
const AutoReadAloudButton: React.FC<AutoReadAloudButtonProps> = ({ disabled }) => {
  const { t } = useTranslation();
  const { settings, update } = useFoolVoiceSettings();
  const enabled = settings.playback.autoReadAloud;

  const toggle = useCallback(() => {
    update((previous) => ({
      ...previous,
      playback: { ...previous.playback, autoReadAloud: !previous.playback.autoReadAloud },
    }));
  }, [update]);

  const label = enabled ? t('conversation.chat.voice.autoReadOn') : t('conversation.chat.voice.autoReadOff');

  return (
    <Tooltip content={label} mini>
      <Button
        type='text'
        size='small'
        shape='circle'
        aria-label={label}
        aria-pressed={enabled}
        data-testid='voice-auto-read'
        data-enabled={enabled ? 'true' : 'false'}
        disabled={disabled}
        onClick={toggle}
        className={enabled ? 'text-primary' : 'text-t-tertiary'}
        icon={enabled ? <VolumeNotice theme='filled' size={18} /> : <VolumeMute theme='outline' size={18} />}
      />
    </Tooltip>
  );
};

export default AutoReadAloudButton;
