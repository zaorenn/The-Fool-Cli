/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import { Button, Tag, Tooltip } from '@arco-design/web-react';
import { Check, PlayOne, VolumeUp } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { VoiceModel, VoiceProfile } from '@/common/types/foolVoice';

export type VoicePickerProps = {
  /** Installable text-to-speech models, in catalog order. */
  models: readonly VoiceModel[];
  /** Preset voices across every model. */
  profiles: readonly VoiceProfile[];
  selectedProfileId: string;
  onSelect: (profile: VoiceProfile) => void;
  onPreview: (profile: VoiceProfile) => Promise<void>;
  onInstall: (modelId: string) => void;
};

const isInstalled = (model: VoiceModel): boolean => model.state.status === 'ready';

/**
 * Voices are chosen by clicking a card, never by typing an id.
 *
 * Voices belonging to a model that is not installed stay visible but are not
 * selectable, so the full range is discoverable and the missing download is
 * obvious rather than hidden.
 */
const VoicePicker: React.FC<VoicePickerProps> = ({
  models,
  profiles,
  selectedProfileId,
  onSelect,
  onPreview,
  onInstall,
}) => {
  const { t } = useTranslation();
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const handlePreview = useCallback(
    (profile: VoiceProfile) => {
      setPreviewingId(profile.id);
      void onPreview(profile).finally(() => setPreviewingId(null));
    },
    [onPreview]
  );

  const speechModels = models.filter((model) => model.role === 'text-to-speech');

  return (
    <div className='flex flex-col gap-16px' data-testid='voice-picker'>
      {speechModels.map((model) => {
        const modelProfiles = profiles.filter((profile) => profile.modelId === model.id);
        if (modelProfiles.length === 0) return null;
        const installed = isInstalled(model);

        return (
          <section key={model.id} data-testid={`voice-group-${model.id}`}>
            <header className='flex items-center gap-8px mb-8px'>
              <VolumeUp theme='outline' size='16' />
              <span className='text-13px font-500 text-t-primary'>{model.displayName}</span>
              <Tag size='small' color='arcoblue'>
                {t('settings.voice.local')}
              </Tag>
              {!installed && (
                <Button
                  size='mini'
                  type='primary'
                  data-testid={`voice-model-install-${model.id}`}
                  onClick={() => onInstall(model.id)}
                  loading={model.state.status === 'installing' || model.state.status === 'partial'}
                  disabled={model.state.status === 'installing' || model.state.status === 'partial'}
                >
                  {model.state.status === 'partial'
                    ? `${Math.round(('downloadedBytes' in model.state ? model.state.downloadedBytes : 0) / 1024 / 1024)}MB`
                    : model.state.status === 'installing'
                      ? t('settings.voice.installing')
                      : t('settings.voice.install')}
                </Button>
              )}
            </header>

            <div className='grid grid-cols-2 gap-8px sm:grid-cols-3'>
              {modelProfiles.map((profile) => {
                const selected = profile.id === selectedProfileId;

                return (
                  <div
                    key={profile.id}
                    className={`flex items-center justify-between gap-8px rounded-8px px-12px py-8px border ${
                      selected ? 'border-primary bg-aou-2' : 'border-fill-2'
                    } ${installed ? 'cursor-pointer hover:bg-fill-1' : 'opacity-50'}`}
                    data-testid={`voice-option-${profile.id}`}
                    aria-pressed={selected}
                    role='button'
                    tabIndex={installed ? 0 : -1}
                    onClick={() => installed && onSelect(profile)}
                    onKeyDown={(event) => {
                      if (!installed) return;
                      if (event.key === 'Enter' || event.key === ' ') onSelect(profile);
                    }}
                  >
                    <span className='text-13px text-t-primary truncate'>{profile.displayName}</span>
                    <span className='flex items-center gap-4px shrink-0'>
                      {selected && <Check theme='outline' size='14' />}
                      <Tooltip content={t('settings.voice.preview')} mini>
                        <Button
                          type='text'
                          size='mini'
                          shape='circle'
                          disabled={!installed}
                          loading={previewingId === profile.id}
                          aria-label={t('settings.voice.preview')}
                          data-testid={`voice-preview-${profile.id}`}
                          icon={<PlayOne theme='outline' size='14' />}
                          onClick={(event) => {
                            event.stopPropagation();
                            handlePreview(profile);
                          }}
                        />
                      </Tooltip>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default VoicePicker;
