/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Message, Radio, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import {
  AUDIOCPP_CHATTERBOX_MODEL_ID,
  AUDIOCPP_QWEN3_MODEL_ID,
  localProviderFor,
  synthesisProviderFor,
  type FoolVoiceSettings,
  type VoiceEngineBackend,
  type VoiceParams,
  type VoiceProfile,
} from '@/common/types/foolVoice';
import { AudioPlaybackService } from '@renderer/services/voice/AudioPlaybackService';
import { useVoiceCatalog } from '../useVoiceCatalog';
import CloneVoiceUpload from './CloneVoiceUpload';
import SpeakerBrowser from './SpeakerBrowser';
import VoiceParamsSection from './VoiceParamsSection';
import VoicePicker from './VoicePicker';

/**
 * Choosing a voice, cloning one, and tuning how it speaks.
 *
 * Its own component rather than a block inside the settings page because two
 * screens need exactly this and neither is the other's parent: Settings shows
 * it as one section among many, and the voice conversation page shows it beside
 * the button that starts talking — which is where a person actually wants to
 * change the voice or drop in a new clip to imitate.
 *
 * Everything it does is persisted through `onChange`, so the two screens are
 * the same surface rather than two copies of it.
 */

export type TextToSpeechSectionProps = {
  settings: FoolVoiceSettings;
  onChange: (change: (previous: FoolVoiceSettings) => FoolVoiceSettings) => void;
};

const PREVIEW_TEXT: Record<string, string> = {
  en: 'This is how I will sound when I speak.',
  tr: 'Konuşurken sesim böyle çıkacak.',
};

const newRequestId = () => `voice-tts-${crypto.randomUUID()}`;

/**
 * The voices that will not run on a processor.
 *
 * Both render fine on a CPU in the sense that audio comes out — at forty
 * seconds to two minutes a sentence, which is not a voice anyone will use. The
 * engine refuses them rather than letting that be discovered a minute at a
 * time, so the picker has to say why before the click.
 */
const GPU_ONLY_MODEL_IDS = new Set<string>([AUDIOCPP_CHATTERBOX_MODEL_ID, AUDIOCPP_QWEN3_MODEL_ID]);

const unwrap = <T,>(envelope: { ok: true; data: T } | { ok: false; error: { code: string } }): T => {
  if (envelope.ok === false) throw new Error(envelope.error.code);
  return envelope.data;
};

const TextToSpeechSection: React.FC<TextToSpeechSectionProps> = ({ settings, onChange }) => {
  const { t } = useTranslation();
  const catalog = useVoiceCatalog(settings.tts.backend);
  const [browsingModelId, setBrowsingModelId] = useState<string | null>(null);
  const [speakerCount, setSpeakerCount] = useState<number | null>(null);

  const playback = useMemo(() => new AudioPlaybackService(), []);

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
            backend: settings.tts.backend,
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
    [
      catalog.models,
      playback,
      settings.devices.outputDeviceId,
      settings.tts.backend,
      settings.tts.params,
      settings.tts.speed,
    ]
  );

  const handleSelectVoice = useCallback(
    (profile: VoiceProfile) => {
      onChange((previous) => ({
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
    [catalog.models, onChange]
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
      onChange((previous) => {
        const next = { ...previous.tts.params };
        // An empty bag is stored as no bag at all: absent means "the engine's
        // defaults", so keeping an empty record around would only be a slot for
        // a stale model id to live in.
        if (Object.keys(params).length === 0) delete next[previous.tts.modelId];
        else next[previous.tts.modelId] = params;
        return { ...previous, tts: { ...previous.tts, params: next } };
      });
    },
    [onChange]
  );

  const browsingModel = catalog.models.find((model) => model.id === browsingModelId) ?? null;
  const selectedTtsModel = catalog.models.find((model) => model.id === settings.tts.modelId);

  const backend = settings.tts.backend;
  const selectedNeedsGpu = GPU_ONLY_MODEL_IDS.has(settings.tts.modelId);

  return (
    <>
      <label className='mb-12px grid gap-6px'>
        <Typography.Text className='text-12px font-600 text-t-secondary'>
          {t('settings.voice.engineBackend')}
        </Typography.Text>
        <Radio.Group
          type='button'
          value={backend}
          onChange={(value: VoiceEngineBackend) =>
            onChange((previous) => ({ ...previous, tts: { ...previous.tts, backend: value } }))
          }
        >
          <Radio value='cpu'>{t('settings.voice.engineBackendCpu')}</Radio>
          <Radio value='cuda'>{t('settings.voice.engineBackendCuda')}</Radio>
        </Radio.Group>
        <Typography.Text className='text-11px text-t-tertiary'>
          {backend === 'cuda' ? t('settings.voice.engineBackendCudaHint') : t('settings.voice.engineBackendCpuHint')}
        </Typography.Text>
      </label>

      {/* Said here rather than at the moment of speaking: the alternative is a
          conversation that starts and then has nothing to say with. */}
      {selectedNeedsGpu && backend !== 'cuda' && (
        <Alert className='mb-12px' type='warning' content={t('settings.voice.engineBackendGpuRequired')} />
      )}

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

      {browsingModel && speakerCount !== null && (
        <SpeakerBrowser
          model={browsingModel}
          speakerCount={speakerCount}
          selectedProfileId={settings.tts.profileId}
          onClose={() => setBrowsingModelId(null)}
          onSelect={(profileId) =>
            onChange((previous) => ({
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
    </>
  );
};

export default TextToSpeechSection;
