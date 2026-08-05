/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Input, Select, Slider, Switch } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useFoolVoiceSettings } from '@renderer/hooks/voice/useFoolVoiceSettings';
import { reconcileVoiceModels } from '@renderer/services/voice/reconcileVoiceModels';
import AudioDeviceSection from './AudioDeviceSection';
import SummarySection from './SummarySection';
import TranscriptRulesSection from './TranscriptRulesSection';
import VoiceAgentSection from './VoiceAgentSection';
import WakeWordSection from './WakeWordSection';
import TextToSpeechSection from './tts/TextToSpeechSection';
import { useVoiceCatalog } from './useVoiceCatalog';

type Section = { key: string; title: string; body: React.ReactNode };

/**
 * The Voice settings surface.
 *
 * Everything here is persisted as it changes and read back by the rest of the
 * app — the talk button, the read-aloud button and the wake-word listener all
 * use the same stored settings, so a device or voice chosen here is the one that
 * is actually used.
 */
const VoiceSettingsContent: React.FC = () => {
  const { t } = useTranslation();
  const { settings, ready, update } = useFoolVoiceSettings();
  const catalog = useVoiceCatalog();
  // Point the selection at models that are really installed. The shipped default
  // names a half-gigabyte download, so without this the page opens claiming to
  // use a model the user does not have while ignoring the ones they do.
  const reconciled = useRef(false);
  useEffect(() => {
    if (!ready || reconciled.current || catalog.models.length === 0) return;
    const next = reconcileVoiceModels(settings, catalog.models);
    reconciled.current = true;
    if (next) update(() => next);
  }, [catalog.models, ready, settings, update]);

  const sttModels = catalog.models.filter((model) => model.role === 'speech-to-text');
  const selectedSttModel = catalog.models.find((model) => model.id === settings.stt.modelId);
  const sttInstall = catalog.installs[settings.stt.modelId];
  const sttVerification = catalog.verifications[settings.stt.modelId];

  const sections: Section[] = [
    {
      key: 'devices',
      title: t('settings.voice.devices'),
      body: (
        <AudioDeviceSection
          devices={settings.devices}
          volume={settings.playback.volume}
          onChange={(devices) => update((previous) => ({ ...previous, devices }))}
        />
      ),
    },
    {
      key: 'wakeWord',
      title: t('settings.voice.wakeWord'),
      body: (
        <WakeWordSection
          settings={settings}
          listenModel={selectedSttModel}
          onChange={update}
          onInstallModel={() => catalog.install(settings.stt.modelId)}
        />
      ),
    },
    {
      key: 'voiceAgent',
      title: t('settings.voice.agentSection'),
      body: <VoiceAgentSection settings={settings} onChange={update} />,
    },
    {
      key: 'conversation',
      title: t('settings.voice.conversation'),
      body: (
        <div className='flex flex-col gap-12px'>
          <label className='flex items-center justify-between'>
            <span className='text-13px text-t-secondary'>{t('settings.voice.bargeIn')}</span>
            <Switch checked={settings.playback.interruptible} disabled />
          </label>
          <label className='flex flex-col gap-4px'>
            <span className='text-13px text-t-secondary'>{t('settings.voice.silenceTimeout')}</span>
            <Slider
              min={250}
              max={3000}
              step={50}
              value={settings.vad.silenceMs}
              onChange={(value) =>
                update((previous) => ({
                  ...previous,
                  vad: { ...previous.vad, silenceMs: Array.isArray(value) ? value[0] : value },
                }))
              }
            />
          </label>
          <label className='flex flex-col gap-4px'>
            <span className='text-13px text-t-secondary'>
              {t('settings.voice.vadSensitivity', 'Voice Sensitivity')}
            </span>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={settings.vad.sensitivity}
              onChange={(value) =>
                update((previous) => ({
                  ...previous,
                  vad: { ...previous.vad, sensitivity: Array.isArray(value) ? value[0] : value },
                }))
              }
            />
          </label>
        </div>
      ),
    },
    {
      key: 'spokenSummary',
      title: t('settings.voice.spokenSummary'),
      body: <SummarySection settings={settings} onChange={update} />,
    },
    {
      key: 'speechToText',
      title: t('settings.voice.speechToText'),
      body: (
        <div className='flex flex-col gap-8px'>
          <div className='flex gap-8px items-center'>
            <Select
              className='flex-1'
              value={settings.stt.modelId}
              onChange={(value: string) =>
                update((previous) => ({ ...previous, stt: { ...previous.stt, modelId: value } }))
              }
              options={sttModels.map((model) => ({
                label: `${model.displayName}${model.state.status === 'ready' ? '' : ` — ${t('settings.voice.notInstalled')}`}`,
                value: model.id,
              }))}
            />
            {selectedSttModel?.state.status !== 'ready' && (
              <Button
                type='primary'
                data-testid='voice-stt-install'
                loading={Boolean(sttInstall) && sttInstall.phase !== 'failed'}
                disabled={Boolean(sttInstall) && sttInstall.phase !== 'failed'}
                onClick={() => catalog.install(settings.stt.modelId)}
              >
                {sttInstall ? t('settings.voice.installing') : t('settings.voice.install')}
              </Button>
            )}
            <Button
              data-testid='voice-stt-verify'
              loading={sttVerification === 'checking'}
              onClick={() => catalog.verify(settings.stt.modelId)}
            >
              {t('settings.voice.check')}
            </Button>
          </div>
          {sttInstall && sttInstall.totalBytes && sttInstall.phase !== 'failed' && (
            <span className='text-12px text-t-secondary' data-testid='voice-stt-progress'>
              {`${Math.min(99, Math.floor((sttInstall.downloadedBytes / sttInstall.totalBytes) * 100))}% · ${Math.round(sttInstall.downloadedBytes / 1024 / 1024)}/${Math.round(sttInstall.totalBytes / 1024 / 1024)}MB`}
            </span>
          )}
          {sttInstall?.phase === 'failed' && (
            <span className='text-12px text-danger'>{t('settings.voice.installFailed')}</span>
          )}
          {sttVerification === 'usable' && (
            <span className='text-12px text-success'>{t('settings.voice.checkUsable')}</span>
          )}
          {(sttVerification === 'unusable' || sttVerification === 'not-installed') && (
            <span className='text-12px text-danger'>
              {sttVerification === 'not-installed' ? t('settings.voice.notInstalled') : t('settings.voice.checkBroken')}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'transcriptRules',
      title: t('settings.voice.transcriptRules'),
      body: <TranscriptRulesSection settings={settings} onChange={update} />,
    },
    {
      key: 'textToSpeech',
      title: t('settings.voice.textToSpeech'),
      body: <TextToSpeechSection settings={settings} onChange={update} />,
    },
  ];

  return (
    <div className='flex flex-col gap-24px'>
      {catalog.loadFailed && <Alert type='warning' content={t('settings.voice.catalogUnavailable')} />}
      {sections.map((section) => (
        <section key={section.key} data-testid={`voice-section-${section.key}`}>
          <h3 className='text-14px font-500 text-t-primary mb-12px'>{section.title}</h3>
          {section.body}
        </section>
      ))}
    </div>
  );
};

export default VoiceSettingsContent;
