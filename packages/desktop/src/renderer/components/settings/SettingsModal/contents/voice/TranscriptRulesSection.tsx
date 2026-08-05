/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { InputTag, Slider, Switch, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { FoolVoiceSettings } from '@/common/types/foolVoice';

/**
 * How much of what was heard survives to become an instruction.
 *
 * Two unrelated knobs, kept together because they answer the same complaint.
 * The threshold decides what counts as speech at all — too low and the room's
 * hum opens a turn, too high and a quiet sentence is never heard. The rules
 * decide what the words mean once they exist: whether "ııı" is part of the
 * instruction, and whether saying "salı, pardon, çarşamba" changes the day.
 *
 * All of it is switchable because all of it can be wrong. Someone dictating a
 * transcript word for word wants none of the rules; someone in a loud room
 * wants a high threshold and someone in a quiet one wants the opposite.
 */

type TranscriptRulesSectionProps = {
  settings: FoolVoiceSettings;
  onChange: (change: (previous: FoolVoiceSettings) => FoolVoiceSettings) => void;
};

const sliderValue = (value: number | number[]): number => (Array.isArray(value) ? value[0] : value);

const TranscriptRulesSection: React.FC<TranscriptRulesSectionProps> = ({ settings, onChange }) => {
  const { t } = useTranslation();
  const rules = settings.transcript;

  const patchRules = (change: Partial<FoolVoiceSettings['transcript']>): void => {
    onChange((previous) => ({ ...previous, transcript: { ...previous.transcript, ...change } }));
  };

  const toggle = (key: 'removeFillers' | 'selfCorrection' | 'collapseRepeats', label: string, description: string) => (
    <div className='flex items-start justify-between gap-16px'>
      <div className='min-w-0'>
        <Typography.Text className='block text-13px text-t-primary'>{label}</Typography.Text>
        <Typography.Text className='block text-12px leading-18px text-t-tertiary'>{description}</Typography.Text>
      </div>
      <Switch className='mt-2px shrink-0' checked={rules[key]} onChange={(checked) => patchRules({ [key]: checked })} />
    </div>
  );

  return (
    <div className='flex flex-col gap-16px'>
      <label className='flex flex-col gap-4px'>
        <span className='text-13px text-t-secondary'>{t('settings.voice.speechThreshold')}</span>
        <Typography.Text className='text-12px leading-18px text-t-tertiary'>
          {t('settings.voice.speechThresholdHint')}
        </Typography.Text>
        <Slider
          min={0}
          max={1}
          step={0.05}
          showTicks={false}
          value={settings.vad.sensitivity}
          formatTooltip={(value) => `${Math.round(Number(value) * 100)}%`}
          onChange={(value) =>
            onChange((previous) => ({ ...previous, vad: { ...previous.vad, sensitivity: sliderValue(value) } }))
          }
        />
      </label>

      <label className='flex flex-col gap-4px'>
        <span className='text-13px text-t-secondary'>{t('settings.voice.minimumSpeech')}</span>
        <Typography.Text className='text-12px leading-18px text-t-tertiary'>
          {t('settings.voice.minimumSpeechHint')}
        </Typography.Text>
        <Slider
          min={100}
          max={2000}
          step={50}
          value={settings.vad.minimumSpeechMs}
          formatTooltip={(value) => `${value} ms`}
          onChange={(value) =>
            onChange((previous) => ({ ...previous, vad: { ...previous.vad, minimumSpeechMs: sliderValue(value) } }))
          }
        />
      </label>

      {toggle('removeFillers', t('settings.voice.removeFillers'), t('settings.voice.removeFillersHint'))}
      {toggle('selfCorrection', t('settings.voice.selfCorrection'), t('settings.voice.selfCorrectionHint'))}
      {toggle('collapseRepeats', t('settings.voice.collapseRepeats'), t('settings.voice.collapseRepeatsHint'))}

      <label className='flex flex-col gap-4px'>
        <span className='text-13px text-t-secondary'>{t('settings.voice.customFillers')}</span>
        <Typography.Text className='text-12px leading-18px text-t-tertiary'>
          {t('settings.voice.customFillersHint')}
        </Typography.Text>
        <InputTag
          allowClear
          value={[...rules.customFillers]}
          disabled={!rules.removeFillers}
          onChange={(value: string[]) =>
            patchRules({ customFillers: value.map((entry) => entry.trim()).filter((entry) => entry.length > 0) })
          }
          placeholder={t('settings.voice.customFillersPlaceholder')}
        />
      </label>
    </div>
  );
};

export default TranscriptRulesSection;
