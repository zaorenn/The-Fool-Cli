/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Button, Modal, Select } from '@arco-design/web-react';
import { PlayOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { VoiceModel } from '@/common/types/foolVoice';

export type SpeakerBrowserProps = {
  model: VoiceModel;
  /** Speakers the installed weights carry, as reported by the engine. */
  speakerCount: number;
  /** Currently selected voice id, so a numbered speaker shows as chosen. */
  selectedProfileId: string;
  onSelect: (profileId: string) => void;
  onPreview: (profileId: string) => Promise<void>;
  onClose: () => void;
};

/** Mirrors `dynamicSpeakerId` in the speech provider. */
export const speakerProfileId = (speakerIndex: number): string => `speaker-${speakerIndex}`;

const parseSpeakerIndex = (profileId: string): number | null => {
  const match = /^speaker-(\d+)$/.exec(profileId);
  return match ? Number(match[1]) : null;
};

/**
 * Every voice in a multi-speaker model, picked by number.
 *
 * LibriTTS-R carries 904 speakers and Supertonic ten; presenting those as cards
 * would bury the page, and presenting only a curated handful would hide most of
 * what the user downloaded. So they are searchable by index, with a preview
 * before committing.
 */
const SpeakerBrowser: React.FC<SpeakerBrowserProps> = ({
  model,
  speakerCount,
  selectedProfileId,
  onSelect,
  onPreview,
  onClose,
}) => {
  const { t } = useTranslation();
  const [speaker, setSpeaker] = useState<number>(() => parseSpeakerIndex(selectedProfileId) ?? 0);
  const [previewing, setPreviewing] = useState(false);

  const options = useMemo(
    () =>
      Array.from({ length: speakerCount }, (_, index) => ({
        label: t('settings.voice.speakerNumber', { number: index }),
        value: index,
      })),
    [speakerCount, t]
  );

  const handlePreview = useCallback(() => {
    setPreviewing(true);
    void onPreview(speakerProfileId(speaker)).finally(() => setPreviewing(false));
  }, [onPreview, speaker]);

  const handleUse = useCallback(() => {
    onSelect(speakerProfileId(speaker));
    onClose();
  }, [onClose, onSelect, speaker]);

  return (
    <Modal
      visible
      title={t('settings.voice.allVoicesTitle', { name: model.displayName })}
      onCancel={onClose}
      footer={null}
      unmountOnExit
    >
      <div className='flex flex-col gap-12px' data-testid='speaker-browser'>
        <p className='text-13px text-t-secondary m-0'>
          {t('settings.voice.allVoicesDescription', { count: speakerCount })}
        </p>
        <Select
          showSearch
          data-testid='speaker-browser-select'
          value={speaker}
          onChange={(value: number) => setSpeaker(value)}
          options={options}
          // 904 options: rendered through the virtual list so opening stays instant.
          // Search matches the label, which carries the number the user types.
          virtualListProps={{ height: 240 }}
        />
        <div className='flex gap-8px justify-end'>
          <Button
            data-testid='speaker-browser-preview'
            loading={previewing}
            icon={<PlayOne theme='outline' size='14' />}
            onClick={handlePreview}
          >
            {t('settings.voice.preview')}
          </Button>
          <Button type='primary' data-testid='speaker-browser-use' onClick={handleUse}>
            {t('settings.voice.useThisVoice')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default SpeakerBrowser;
