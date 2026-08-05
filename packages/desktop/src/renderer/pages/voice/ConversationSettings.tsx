/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Input, Select, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import {
  PERSONA_PRESET_IDS,
  REALTIME_PROVIDER_IDS,
  REALTIME_PROVIDER_SPECS,
  type PersonaPresetId,
  type RealtimeProviderId,
} from '@/common/realtime';
import type { FoolVoiceSettings } from '@/common/types/foolVoice';

/**
 * The four decisions that change what a conversation is like.
 *
 * Everything else about the voice loop lives in Settings; these are here,
 * beside the button that starts it, because they are the ones a person changes
 * *between* conversations rather than once — who they are talking to today, in
 * what language, and about what.
 */

type ConversationSettingsProps = {
  settings: FoolVoiceSettings;
  disabled: boolean;
  onChange: (change: (previous: FoolVoiceSettings) => FoolVoiceSettings) => void;
};

/** Languages the app itself speaks, plus following whoever is talking. */
const LANGUAGES = ['auto', 'en', 'tr', 'de', 'fr', 'es', 'pt', 'ru', 'uk', 'ja', 'ko', 'zh', 'fa'] as const;

const ConversationSettings: React.FC<ConversationSettingsProps> = ({ settings, disabled, onChange }) => {
  const { t } = useTranslation();
  const realtime = settings.realtime;
  const spec = REALTIME_PROVIDER_SPECS[realtime.providerId as RealtimeProviderId];

  const voiceOptions = useMemo(() => spec.voices.map((voice) => ({ label: voice, value: voice })), [spec.voices]);

  const patch = (change: Partial<FoolVoiceSettings['realtime']>): void => {
    onChange((previous) => ({ ...previous, realtime: { ...previous.realtime, ...change } }));
  };

  return (
    <div className='grid gap-12px'>
      <label className='grid gap-5px'>
        <Typography.Text className='text-12px font-600 text-t-secondary'>
          {t('settings.voice.conversationProvider')}
        </Typography.Text>
        <Select
          value={realtime.providerId}
          disabled={disabled}
          onChange={(value: RealtimeProviderId) => {
            // The voice list is per provider, so carrying the old one over would
            // leave a Gemini session asking for `marin` and being refused at
            // connection time with a message from Google.
            patch({ providerId: value, voice: REALTIME_PROVIDER_SPECS[value].defaultVoice, model: '' });
          }}
          options={REALTIME_PROVIDER_IDS.map((id) => ({
            label: t(`settings.voice.conversationProviderName.${id}`),
            value: id,
          }))}
        />
      </label>

      <div className='grid grid-cols-2 gap-10px'>
        <label className='grid gap-5px'>
          <Typography.Text className='text-12px font-600 text-t-secondary'>
            {t('settings.voice.conversationVoice')}
          </Typography.Text>
          <Select
            value={realtime.voice}
            disabled={disabled || voiceOptions.length <= 1}
            onChange={(value: string) => patch({ voice: value })}
            options={voiceOptions}
          />
        </label>

        <label className='grid gap-5px'>
          <Typography.Text className='text-12px font-600 text-t-secondary'>
            {t('settings.voice.conversationLanguage')}
          </Typography.Text>
          <Select
            value={realtime.language}
            disabled={disabled}
            onChange={(value: string) => patch({ language: value })}
            options={LANGUAGES.map((code) => ({
              label:
                code === 'auto'
                  ? t('settings.voice.conversationLanguageAuto')
                  : t(`settings.voice.conversationLanguageName.${code}`),
              value: code,
            }))}
          />
        </label>
      </div>

      <label className='grid gap-5px'>
        <Typography.Text className='text-12px font-600 text-t-secondary'>
          {t('settings.voice.conversationPersona')}
        </Typography.Text>
        <Select
          value={realtime.personaPresetId}
          disabled={disabled}
          onChange={(value: PersonaPresetId) => patch({ personaPresetId: value })}
          options={PERSONA_PRESET_IDS.map((id) => ({
            label: t(`settings.voice.conversationPersonaName.${id}`),
            value: id,
          }))}
        />
      </label>

      <label className='grid gap-5px'>
        <Typography.Text className='text-12px font-600 text-t-secondary'>
          {realtime.personaPresetId === 'custom'
            ? t('settings.voice.conversationInstructions')
            : t('settings.voice.conversationInstructionsExtra')}
        </Typography.Text>
        <Input.TextArea
          value={realtime.customInstructions}
          disabled={disabled}
          onChange={(value: string) => patch({ customInstructions: value })}
          autoSize={{ minRows: 3, maxRows: 7 }}
          maxLength={4000}
          showWordLimit
          placeholder={t('settings.voice.conversationInstructionsPlaceholder')}
        />
      </label>

      <label className='grid gap-5px'>
        <Typography.Text className='text-12px font-600 text-t-secondary'>
          {t('settings.voice.conversationModel')}
        </Typography.Text>
        <Input
          value={realtime.model}
          disabled={disabled}
          onChange={(value: string) => patch({ model: value })}
          placeholder={spec.defaultModel}
        />
      </label>
    </div>
  );
};

export default ConversationSettings;
