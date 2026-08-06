/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Collapse, Input, Link, Select, Switch, Tag, Typography } from '@arco-design/web-react';
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
// The same picker the Settings modal shows, rather than a second one beside it:
// two controls over one stored value is how they come to disagree.
import VoiceAgentSection from '@renderer/components/settings/SettingsModal/contents/voice/VoiceAgentSection';
import { LOCAL_LLM_DEFAULT_ENDPOINT, listLocalModels } from './localPipeline';
import styles from './VoiceConversationPage.module.css';

/**
 * What to decide before starting a conversation, and everything else folded away.
 *
 * This panel had grown to fourteen controls in one column, all at the same
 * weight: who you are talking to sat between an audio-interrupt phrase and a
 * vision-model id, and the thing you actually came to press — the microphone —
 * was below the fold. A wall of switches beside a button that starts a
 * conversation reads as a machine to be configured rather than someone to talk
 * to, which is the opposite of what a voice is for.
 *
 * So there are three decisions at the top, in full, because they are the ones
 * that change between one conversation and the next: who is answering, in what
 * language, and as whom. Everything else is set once and then never again, so it
 * is behind a heading that says what it is.
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

/** One labelled control, at the one weight every control in here shares. */
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className='grid gap-5px'>
    <Typography.Text className='text-11px font-600 uppercase tracking-wide text-t-tertiary'>{label}</Typography.Text>
    {children}
  </label>
);

/** A switch with its explanation underneath, which most of these need. */
const Toggle: React.FC<{
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  testId?: string;
  onChange: (value: boolean) => void;
}> = ({ label, hint, checked, disabled, testId, onChange }) => (
  <div className='grid gap-3px'>
    <label className='flex items-center justify-between gap-10px'>
      <Typography.Text className='text-12px text-t-primary'>{label}</Typography.Text>
      <Switch data-testid={testId} size='small' checked={checked} disabled={disabled} onChange={onChange} />
    </label>
    <Typography.Text className='text-11px leading-16px text-t-tertiary'>{hint}</Typography.Text>
  </div>
);

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
      <Field label={t('settings.voice.conversationProvider')}>
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
      </Field>

      <div className={isLocal ? 'grid gap-10px' : 'grid grid-cols-2 gap-10px'}>
        {/* Hidden rather than disabled for the local pipeline: it has no voice
            list of its own, and an empty picker beside a working conversation
            reads as something failing to load. */}
        {isLocal ? null : (
          <Field label={t('settings.voice.conversationVoice')}>
            <Select
              value={realtime.voice}
              disabled={disabled || voiceOptions.length <= 1}
              onChange={(value: string) => patch({ voice: value })}
              options={voiceOptions}
            />
          </Field>
        )}

        <Field label={t('settings.voice.conversationLanguage')}>
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
        </Field>
      </div>

      <Field label={t('settings.voice.conversationPersona')}>
        <Select
          value={realtime.personaPresetId}
          disabled={disabled}
          onChange={(value: PersonaPresetId) => patch({ personaPresetId: value })}
          options={PERSONA_PRESET_IDS.map((id) => ({
            label: t(`settings.voice.conversationPersonaName.${id}`),
            value: id,
          }))}
        />
      </Field>

      {/* Everything below is decided once. Closed by default, in the order they
          are reached for: what it should say, who does the work, then the two
          groups nobody opens twice. */}
      <Collapse bordered={false} className={styles.settingsGroups}>
        <Collapse.Item
          name='instructions'
          header={
            realtime.personaPresetId === 'custom'
              ? t('settings.voice.conversationInstructions')
              : t('settings.voice.conversationInstructionsExtra')
          }
        >
          <Input.TextArea
            value={realtime.customInstructions}
            disabled={disabled}
            onChange={(value: string) => patch({ customInstructions: value })}
            autoSize={{ minRows: 3, maxRows: 7 }}
            maxLength={4000}
            showWordLimit
            placeholder={t('settings.voice.conversationInstructionsPlaceholder')}
          />
        </Collapse.Item>

        {/* Who does the work when the conversation asks for something real —
            the difference between "open YouTube" happening and not, and the
            failure it causes reads as the voice being broken rather than as a
            setting. */}
        <Collapse.Item name='agent' header={t('settings.voice.agentSection')}>
          <div className='grid gap-10px'>
            <VoiceAgentSection settings={settings} onChange={onChange} disabled={disabled} />
            <Toggle
              testId='voice-unattended'
              label={t('settings.voice.conversationUnattended')}
              hint={
                settings.session.unattended
                  ? t('settings.voice.conversationUnattendedOnHint')
                  : t('settings.voice.conversationUnattendedOffHint')
              }
              checked={settings.session.unattended}
              onChange={(value) =>
                onChange((previous) => ({ ...previous, session: { ...previous.session, unattended: value } }))
              }
            />
          </div>
        </Collapse.Item>

        <Collapse.Item name='microphone' header={t('settings.voice.conversationGroupMicrophone')}>
          <div className='grid gap-12px'>
            {/* Whether the microphone is open at all, which decides whether
                silence can be heard as a question. Above interruption because it
                makes most of that question moot: nothing arrives to interrupt
                with. */}
            <Toggle
              testId='voice-hold-to-talk'
              label={t('settings.voice.conversationHoldToTalk')}
              hint={
                settings.activation.conversationHoldToTalk
                  ? t('settings.voice.conversationHoldToTalkOnHint')
                  : t('settings.voice.conversationHoldToTalkOffHint')
              }
              checked={settings.activation.conversationHoldToTalk}
              onChange={(value) =>
                onChange((previous) => ({
                  ...previous,
                  activation: { ...previous.activation, conversationHoldToTalk: value },
                }))
              }
            />

            <Toggle
              label={t('settings.voice.conversationInterruptible')}
              hint={
                settings.playback.interruptible
                  ? t('settings.voice.conversationInterruptibleHint')
                  : t('settings.voice.conversationInterruptibleOffHint')
              }
              checked={settings.playback.interruptible}
              disabled={disabled}
              onChange={(value) =>
                onChange((previous) => ({ ...previous, playback: { ...previous.playback, interruptible: value } }))
              }
            />

            {settings.playback.interruptible ? (
              <Field label={t('settings.voice.conversationInterruptPhrase')}>
                <Input
                  value={settings.playback.interruptPhrase}
                  disabled={disabled}
                  maxLength={64}
                  placeholder='stop'
                  onChange={(value: string) =>
                    onChange((previous) => ({
                      ...previous,
                      playback: { ...previous.playback, interruptPhrase: value },
                    }))
                  }
                />
              </Field>
            ) : null}
          </div>
        </Collapse.Item>

        <Collapse.Item name='model' header={t('settings.voice.conversationGroupModel')}>
          <div className='grid gap-12px'>
            <Field label={isLocal ? t('settings.voice.conversationLocalModel') : t('settings.voice.conversationModel')}>
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
            </Field>

            {isLocal ? (
              <>
                <Field label={t('settings.voice.conversationVisionModel')}>
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
                </Field>

                <Field label={t('settings.voice.conversationLocalEndpoint')}>
                  <Input
                    value={realtime.localEndpoint}
                    disabled={disabled}
                    onChange={(value: string) => patch({ localEndpoint: value })}
                    placeholder={LOCAL_LLM_DEFAULT_ENDPOINT}
                  />
                  <Typography.Text className='text-11px text-t-tertiary'>
                    {t('settings.voice.conversationLocalVoiceHint')}
                  </Typography.Text>
                </Field>
              </>
            ) : null}
          </div>
        </Collapse.Item>
      </Collapse>
    </div>
  );
};

export default ConversationSettings;
