/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Input, Message, Select, Slider, Switch } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { localProviderFor, synthesisProviderFor, type VoiceParams, type VoiceProfile } from '@/common/types/foolVoice';
import { useFoolVoiceSettings } from '@renderer/hooks/voice/useFoolVoiceSettings';
import { AudioPlaybackService } from '@renderer/services/voice/AudioPlaybackService';
import { reconcileVoiceModels } from '@renderer/services/voice/reconcileVoiceModels';
import AudioDeviceSection from './AudioDeviceSection';
import SummarySection from './SummarySection';
import VoiceAgentSection from './VoiceAgentSection';
import WakeWordSection from './WakeWordSection';
import CloneVoiceUpload from './tts/CloneVoiceUpload';
import SpeakerBrowser from './tts/SpeakerBrowser';
import VoiceParamsSection from './tts/VoiceParamsSection';
import VoicePicker from './tts/VoicePicker';
import { useVoiceCatalog } from './useVoiceCatalog';

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
 * Everything here is persisted as it changes and read back by the rest of the
 * app — the talk button, the read-aloud button and the wake-word listener all
 * use the same stored settings, so a device or voice chosen here is the one that
 * is actually used.
 */
const VoiceSettingsContent: React.FC = () => {
  const { t } = useTranslation();
  const { settings, ready, update } = useFoolVoiceSettings();
  const catalog = useVoiceCatalog();
  const [browsingModelId, setBrowsingModelId] = useState<string | null>(null);
  const [speakerCount, setSpeakerCount] = useState<number | null>(null);

  const playback = useMemo(() => new AudioPlaybackService(), []);

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

  const speak = useCallback(
    async (modelId: string, profileId: string, language: string) => {
      playback.setOutputDevice(settings.devices.outputDeviceId);
      const requestId = newRequestId();
      const synthesis = unwrap(
        await ipcBridge.foolVoice.synthesize.invoke({
          version: 1,
          requestId,
          payload: {
            operationId: requestId,
            providerId: synthesisProviderFor(catalog.models, modelId),
            modelId,
            profileId,
            language,
            speed: settings.tts.speed,
            text: PREVIEW_TEXT[language] ?? PREVIEW_TEXT.en,
            // The preview is the only place the knobs can be heard before a
            // real reply is spoken with them, so it uses the saved values
            // rather than the engine's defaults.
            ...(settings.tts.params[modelId] ? { params: settings.tts.params[modelId] } : {}),
          },
        })
      );
      await playback.play(synthesis.audio);
    },
    [catalog.models, playback, settings.devices.outputDeviceId, settings.tts.params, settings.tts.speed]
  );

  const handleSelectVoice = useCallback(
    (profile: VoiceProfile) => {
      update((previous) => ({
        ...previous,
        tts: {
          ...previous.tts,
          // A cloned voice appears once per engine that can render it, so the
          // card that was clicked is what says which engine will speak — and
          // the provider has to be recorded with it, or every later request
          // goes to whichever engine happened to be stored first.
          providerId: synthesisProviderFor(catalog.models, profile.modelId),
          modelId: profile.modelId,
          profileId: profile.id,
          language: profile.languages[0] ?? previous.tts.language,
        },
      }));
    },
    [update]
  );

  const handlePreview = useCallback(
    async (profile: VoiceProfile) => {
      try {
        await speak(profile.modelId, profile.id, profile.languages[0] ?? 'en');
      } catch {
        Message.error(t('settings.voice.previewFailed'));
      }
    },
    [speak, t]
  );

  const handleDeleteClonedVoice = useCallback(
    async (profile: VoiceProfile) => {
      const voiceId = profile.id.startsWith('cloned:') ? profile.id.slice('cloned:'.length) : profile.id;
      try {
        unwrap(
          await ipcBridge.foolVoice.deleteClonedVoice.invoke({
            version: 1,
            requestId: newRequestId(),
            payload: { voiceId },
          })
        );
        void catalog.refresh();
      } catch {
        Message.error(t('settings.voice.deleteClonedFailed'));
      }
    },
    [catalog, t]
  );

  const handleBrowseSpeakers = useCallback(
    (modelId: string) => {
      setSpeakerCount(null);
      setBrowsingModelId(modelId);

      // The count comes from the loaded engine, so it reflects the weights that
      // were actually downloaded.
      void ipcBridge.foolVoice.speakers
        .invoke({
          version: 1,
          requestId: newRequestId(),
          payload: { providerId: localProviderFor(catalog.models, modelId), modelId },
        })
        .then((response) => setSpeakerCount(response.ok ? response.data.speakerCount : 0))
        .catch(() => setSpeakerCount(0));
    },
    [catalog.models]
  );

  const handleParamsChange = useCallback(
    (params: VoiceParams) => {
      update((previous) => {
        const next = { ...previous.tts.params };
        // An empty bag is stored as no bag at all: absent means "the engine's
        // defaults", so keeping an empty record around would only be a slot for
        // a stale model id to live in.
        if (Object.keys(params).length === 0) delete next[previous.tts.modelId];
        else next[previous.tts.modelId] = params;
        return { ...previous, tts: { ...previous.tts, params: next } };
      });
    },
    [update]
  );

  const browsingModel = catalog.models.find((model) => model.id === browsingModelId) ?? null;
  const selectedTtsModel = catalog.models.find((model) => model.id === settings.tts.modelId);

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
      key: 'textToSpeech',
      title: t('settings.voice.textToSpeech'),
      body: (
        <>
          <VoicePicker
            models={catalog.models}
            profiles={catalog.profiles}
            selectedProfileId={settings.tts.profileId}
            selectedModelId={settings.tts.modelId}
            installs={catalog.installs}
            verifications={catalog.verifications}
            onSelect={handleSelectVoice}
            onPreview={handlePreview}
            onInstall={catalog.install}
            onVerify={catalog.verify}
            onBrowseSpeakers={handleBrowseSpeakers}
            onDelete={handleDeleteClonedVoice}
          />
          <CloneVoiceUpload
            models={catalog.models}
            preferredModelId={settings.tts.modelId}
            onSaved={() => void catalog.refresh()}
          />
          <VoiceParamsSection
            model={selectedTtsModel}
            params={settings.tts.params[settings.tts.modelId] ?? {}}
            onChange={handleParamsChange}
          />
        </>
      ),
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

      {browsingModel && speakerCount !== null && (
        <SpeakerBrowser
          model={browsingModel}
          speakerCount={speakerCount}
          selectedProfileId={settings.tts.profileId}
          onClose={() => setBrowsingModelId(null)}
          onSelect={(profileId) =>
            update((previous) => ({
              ...previous,
              tts: {
                ...previous.tts,
                providerId: synthesisProviderFor(catalog.models, browsingModel.id),
                modelId: browsingModel.id,
                profileId,
                language: browsingModel.languages[0] ?? previous.tts.language,
              },
            }))
          }
          onPreview={async (profileId) => {
            try {
              await speak(browsingModel.id, profileId, browsingModel.languages[0] ?? 'en');
            } catch {
              Message.error(t('settings.voice.previewFailed'));
            }
          }}
        />
      )}
    </div>
  );
};

export default VoiceSettingsContent;
