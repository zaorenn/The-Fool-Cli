/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Input, Link, Select, Switch, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { IProvider } from '@/common/config/storage';
import {
  PERSONA_PRESET_IDS,
  REALTIME_PROVIDER_IDS,
  REALTIME_PROVIDER_SPECS,
  type PersonaPresetId,
  type VoiceConversationProviderId,
} from '@/common/realtime';
import type { FoolVoiceSettings } from '@/common/types/foolVoice';
import { LOCAL_LLM_DEFAULT_ENDPOINT, listLocalModels } from './localPipeline';

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

/**
 * Whether the chosen provider can actually open a session, checked up front.
 *
 * Without this the answer arrives only after the user presses start and waits
 * for a socket to fail — which is exactly how "voice chat is broken" gets
 * reported for what is really an unconfigured API key. Mirrors the main
 * process's own selection rule: the first enabled provider on a platform that
 * can carry this kind of session, with a key in it.
 */
const findCredential = (providers: readonly IProvider[], providerId: VoiceConversationProviderId): IProvider | null => {
  const spec = REALTIME_PROVIDER_SPECS[providerId];
  if (!spec.requiresCredential) return null;
  const platforms = new Set(spec.platforms);
  return (
    providers.find(
      (provider) =>
        provider.enabled !== false && platforms.has(provider.platform) && (provider.api_key ?? '').trim().length > 0
    ) ?? null
  );
};

/** Languages the app itself speaks, plus following whoever is talking. */
const LANGUAGES = ['auto', 'en', 'tr', 'de', 'fr', 'es', 'pt', 'ru', 'uk', 'ja', 'ko', 'zh', 'fa'] as const;

const ConversationSettings: React.FC<ConversationSettingsProps> = ({ settings, disabled, onChange }) => {
  const { t } = useTranslation();
  const realtime = settings.realtime;
  const providerId = realtime.providerId as VoiceConversationProviderId;
  const spec = REALTIME_PROVIDER_SPECS[providerId];
  const isLocal = providerId === 'local-pipeline';

  const voiceOptions = useMemo(() => spec.voices.map((voice) => ({ label: voice, value: voice })), [spec.voices]);

  const [providers, setProviders] = useState<IProvider[]>([]);
  useEffect(() => {
    let live = true;
    void ipcBridge.mode.listProviders
      .invoke()
      .then((list) => {
        if (live) setProviders(list ?? []);
      })
      .catch(() => {
        // An unreadable provider list is reported as "not configured" below,
        // which is the safe reading: it is certainly not usable.
      });
    return () => {
      live = false;
    };
  }, []);

  const credential = useMemo(() => findCredential(providers, providerId), [providers, providerId]);

  /**
   * What the local server currently has loaded.
   *
   * Offered as a list rather than a text field because the id has to match
   * exactly — `google/gemma-4-e4b`, slash and all — and a typo is indis-
   * tinguishable, from the user's side, from the model being unavailable.
   * Re-read whenever the endpoint changes, since it is a different server.
   */
  const [localModels, setLocalModels] = useState<string[]>([]);
  useEffect(() => {
    if (!isLocal) return;
    let live = true;
    void listLocalModels(realtime.localEndpoint).then((ids) => {
      if (live) setLocalModels(ids);
    });
    return () => {
      live = false;
    };
  }, [isLocal, realtime.localEndpoint]);
  const ready = !spec.requiresCredential || credential !== null;

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
          onChange={(value: VoiceConversationProviderId) => {
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
        {ready ? (
          <Tag size='small' color='green'>
            {credential
              ? t('settings.voice.conversationProviderReady', { provider: credential.name })
              : t('settings.voice.conversationProviderLocal')}
          </Tag>
        ) : (
          <div className='flex flex-wrap items-center gap-6px'>
            <Tag size='small' color='orange'>
              {t('settings.voice.conversationProviderMissing')}
            </Tag>
            <Link className='!text-12px' href='#/settings/model'>
              {t('settings.voice.conversationProviderAddKey')}
            </Link>
          </div>
        )}
      </label>

      <div className={isLocal ? 'grid gap-10px' : 'grid grid-cols-2 gap-10px'}>
        {/* Hidden rather than disabled for the local pipeline: it has no voice
            list of its own, and an empty picker beside a working conversation
            reads as something failing to load. */}
        {isLocal ? null : (
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
        )}

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
          {isLocal ? t('settings.voice.conversationLocalModel') : t('settings.voice.conversationModel')}
        </Typography.Text>
        {isLocal ? (
          <Select
            value={realtime.model || undefined}
            disabled={disabled}
            allowCreate
            showSearch
            onChange={(value: string) => patch({ model: value })}
            placeholder={
              localModels.length > 0
                ? t('settings.voice.conversationLocalModelPlaceholder')
                : t('settings.voice.conversationLocalUnreachable')
            }
            options={localModels.map((id) => ({ label: id, value: id }))}
          />
        ) : (
          <Input
            value={realtime.model}
            disabled={disabled}
            onChange={(value: string) => patch({ model: value })}
            placeholder={spec.defaultModel}
          />
        )}
      </label>

      {/* Interruption, which is a conversation setting rather than an audio one:
          it decides what happens to an answer when the room makes a noise. */}
      <div className='grid gap-5px rounded-10px bg-fill-1 px-10px py-9px'>
        <label className='flex items-center justify-between gap-10px'>
          <Typography.Text className='text-12px font-600 text-t-secondary'>
            {t('settings.voice.conversationInterruptible')}
          </Typography.Text>
          <Switch
            size='small'
            checked={settings.playback.interruptible}
            disabled={disabled}
            onChange={(value: boolean) =>
              onChange((previous) => ({ ...previous, playback: { ...previous.playback, interruptible: value } }))
            }
          />
        </label>
        <Typography.Text className='text-11px leading-16px text-t-tertiary'>
          {settings.playback.interruptible
            ? t('settings.voice.conversationInterruptibleHint')
            : t('settings.voice.conversationInterruptibleOffHint')}
        </Typography.Text>
        {settings.playback.interruptible ? (
          <label className='mt-4px grid gap-4px'>
            <Typography.Text className='text-11px text-t-tertiary'>
              {t('settings.voice.conversationInterruptPhrase')}
            </Typography.Text>
            <Input
              value={settings.playback.interruptPhrase}
              disabled={disabled}
              maxLength={64}
              placeholder='stop'
              onChange={(value: string) =>
                onChange((previous) => ({ ...previous, playback: { ...previous.playback, interruptPhrase: value } }))
              }
            />
          </label>
        ) : null}
      </div>

      {isLocal ? (
        <label className='grid gap-5px'>
          <Typography.Text className='text-12px font-600 text-t-secondary'>
            {t('settings.voice.conversationVisionModel')}
          </Typography.Text>
          <Select
            value={realtime.visionModel || ''}
            disabled={disabled}
            allowCreate
            showSearch
            onChange={(value: string) => patch({ visionModel: value })}
            options={[
              { label: t('settings.voice.conversationVisionModelSame'), value: '' },
              ...localModels.map((id) => ({ label: id, value: id })),
            ]}
          />
          <Typography.Text className='text-11px text-t-tertiary'>
            {t('settings.voice.conversationVisionModelHint')}
          </Typography.Text>
        </label>
      ) : null}

      {isLocal ? (
        <label className='grid gap-5px'>
          <Typography.Text className='text-12px font-600 text-t-secondary'>
            {t('settings.voice.conversationLocalEndpoint')}
          </Typography.Text>
          <Input
            value={realtime.localEndpoint}
            disabled={disabled}
            onChange={(value: string) => patch({ localEndpoint: value })}
            placeholder={LOCAL_LLM_DEFAULT_ENDPOINT}
          />
          <Typography.Text className='text-11px text-t-tertiary'>
            {t('settings.voice.conversationLocalVoiceHint')}
          </Typography.Text>
        </label>
      ) : null}
    </div>
  );
};

export default ConversationSettings;
