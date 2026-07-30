/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Message, Select, Slider, Switch } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import {
  DEFAULT_FOOL_VOICE_SETTINGS,
  type FoolVoiceSettings,
  type VoiceModel,
  type VoiceProfile,
} from '@/common/types/foolVoice';
import { AudioPlaybackService } from '@renderer/services/voice/AudioPlaybackService';
import VoicePicker from './VoicePicker';

const PREVIEW_TEXT: Record<string, string> = {
  en: 'This is how I will sound when I speak.',
  tr: 'Konuşurken sesim böyle çıkacak.',
};

const newRequestId = () => `voice-settings-${crypto.randomUUID()}`;

const unwrap = <T,>(envelope: { ok: true; data: T } | { ok: false; error: { code: string } }): T => {
  if (envelope.ok === false) throw new Error(envelope.error.code);
  return envelope.data;
};

type Section = { key: string; title: string; body: React.ReactNode };

/**
 * The Voice settings surface.
 *
 * Voices are picked by clicking a card with a preview button rather than by
 * typing a model or speaker id, and each model states plainly whether it is
 * installed.
 */
const VoiceSettingsContent: React.FC = () => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<FoolVoiceSettings>(DEFAULT_FOOL_VOICE_SETTINGS);
  const [models, setModels] = useState<readonly VoiceModel[]>([]);
  const [profiles, setProfiles] = useState<readonly VoiceProfile[]>([]);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const playback = useMemo(() => new AudioPlaybackService(), []);

  const refreshCatalog = useCallback(async () => {
    try {
      const catalog = unwrap(
        await ipcBridge.foolVoice.catalog.invoke({
          version: 1,
          requestId: newRequestId(),
          payload: { includeProfiles: true },
        })
      );
      setModels(catalog.models);
      setProfiles(catalog.profiles);
      setLoadError(null);
    } catch {
      setLoadError('catalog');
    }
  }, []);

  useEffect(() => {
    void refreshCatalog();

    const unsubscribe = ipcBridge.foolVoice.downloadProgress.on((event) => {
      const payload = event.payload as any;
      if (payload.state === 'ready' || payload.state === 'cancelled' || payload.state === 'invalid') {
        void refreshCatalog();
      } else {
        setModels((prev) =>
          prev.map((m) => {
            if (m.id === payload.modelId && m.distribution === 'managed') {
              const newStatus =
                payload.state === 'queued' ||
                payload.state === 'downloading' ||
                payload.state === 'extracting' ||
                payload.state === 'validating'
                  ? 'partial'
                  : 'installing';
              return {
                ...m,
                state: { status: newStatus, downloadedBytes: payload.downloadedBytes },
              } as VoiceModel;
            }
            return m;
          })
        );
      }
    });

    return () => unsubscribe();
  }, [refreshCatalog]);

  useEffect(() => {
    const loadDevices = async () => {
      try {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((track) => track.stop());
        } catch {
          // ignore, they might not have a mic or denied it
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        setInputDevices(devices.filter((device) => device.kind === 'audioinput'));
        setOutputDevices(devices.filter((device) => device.kind === 'audiooutput'));
      } catch {
        setInputDevices([]);
        setOutputDevices([]);
      }
    };

    void loadDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', loadDevices);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', loadDevices);
  }, []);

  const handleSelectVoice = useCallback((profile: VoiceProfile) => {
    setSettings((previous) => ({
      ...previous,
      tts: {
        ...previous.tts,
        modelId: profile.modelId,
        profileId: profile.id,
        language: profile.languages[0] ?? previous.tts.language,
      },
    }));
  }, []);

  const handlePreview = useCallback(
    async (profile: VoiceProfile) => {
      const language = profile.languages[0] ?? 'en';
      // Honour the speaker chosen above, not just the system default.
      playback.setOutputDevice(settings.devices.outputDeviceId);
      try {
        const requestId = newRequestId();
        const synthesis = unwrap(
          await ipcBridge.foolVoice.synthesize.invoke({
            version: 1,
            requestId,
            payload: {
              operationId: requestId,
              providerId: 'local-sherpa',
              modelId: profile.modelId,
              profileId: profile.id,
              language,
              speed: settings.tts.speed,
              text: PREVIEW_TEXT[language] ?? PREVIEW_TEXT.en,
            },
          })
        );
        await playback.play(synthesis.audio);
      } catch {
        Message.error(t('settings.voice.previewFailed'));
      }
    },
    [playback, settings.devices.outputDeviceId, settings.tts.speed, t]
  );

  const handleInstall = useCallback(
    (modelId: string) => {
      const operationId = newRequestId();
      void ipcBridge.foolVoice.download
        .invoke({ version: 1, requestId: operationId, payload: { operationId, providerId: 'local-sherpa', modelId } })
        .then(() => {
          Message.info(t('settings.voice.installStarted'));
          return refreshCatalog();
        })
        .catch(() => Message.error(t('settings.voice.installFailed')));
    },
    [refreshCatalog, t]
  );

  const sttModels = models.filter((model) => model.role === 'speech-to-text');

  const sections: Section[] = [
    {
      key: 'devices',
      title: t('settings.voice.devices'),
      body: (
        <div className='flex flex-col gap-12px'>
          <label className='flex flex-col gap-4px'>
            <span className='text-13px text-t-secondary'>{t('settings.voice.microphone')}</span>
            <Select
              value={settings.devices.inputDeviceId ?? ''}
              placeholder={t('settings.voice.systemDefault')}
              onChange={(value: string) =>
                setSettings((previous) => ({
                  ...previous,
                  devices: { ...previous.devices, inputDeviceId: value || null },
                }))
              }
              options={inputDevices.map((device) => ({
                label: device.label || device.deviceId,
                value: device.deviceId,
              }))}
            />
          </label>
          <label className='flex flex-col gap-4px'>
            <span className='text-13px text-t-secondary'>{t('settings.voice.speaker')}</span>
            <Select
              value={settings.devices.outputDeviceId ?? ''}
              placeholder={t('settings.voice.systemDefault')}
              onChange={(value: string) =>
                setSettings((previous) => ({
                  ...previous,
                  devices: { ...previous.devices, outputDeviceId: value || null },
                }))
              }
              options={outputDevices.map((device) => ({
                label: device.label || device.deviceId,
                value: device.deviceId,
              }))}
            />
          </label>
        </div>
      ),
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
                setSettings((previous) => ({
                  ...previous,
                  vad: { ...previous.vad, silenceMs: Array.isArray(value) ? value[0] : value },
                }))
              }
            />
          </label>
        </div>
      ),
    },
    {
      key: 'speechToText',
      title: t('settings.voice.speechToText'),
      body: (
        <div className='flex gap-8px items-center'>
          <Select
            className='flex-1'
            value={settings.stt.modelId}
            onChange={(value: string) =>
              setSettings((previous) => ({ ...previous, stt: { ...previous.stt, modelId: value } }))
            }
            options={sttModels.map((model) => ({
              label: `${model.displayName}${model.state.status === 'ready' ? '' : ` — ${t('settings.voice.notInstalled')}`}`,
              value: model.id,
            }))}
          />
          {models.find((m) => m.id === settings.stt.modelId)?.state.status !== 'ready' && (
            <Button onClick={() => handleInstall(settings.stt.modelId)}>{t('settings.voice.install')}</Button>
          )}
        </div>
      ),
    },
    {
      key: 'textToSpeech',
      title: t('settings.voice.textToSpeech'),
      body: (
        <VoicePicker
          models={models}
          profiles={profiles}
          selectedProfileId={settings.tts.profileId}
          onSelect={handleSelectVoice}
          onPreview={handlePreview}
          onInstall={handleInstall}
        />
      ),
    },
  ];

  return (
    <div className='flex flex-col gap-24px'>
      {loadError && <Alert type='warning' content={t('settings.voice.catalogUnavailable')} />}
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
