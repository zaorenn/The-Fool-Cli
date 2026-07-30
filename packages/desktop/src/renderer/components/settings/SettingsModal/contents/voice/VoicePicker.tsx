/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import { Button, Tag, Tooltip } from '@arco-design/web-react';
import { Attention, Check, CloseOne, PlayOne, VolumeUp } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { VoiceModel, VoiceProfile } from '@/common/types/foolVoice';
import type { InstallState, VerificationState } from './useVoiceCatalog';

export type VoicePickerProps = {
  /** Installable text-to-speech models, in catalog order. */
  models: readonly VoiceModel[];
  /** Preset voices across every model. */
  profiles: readonly VoiceProfile[];
  selectedProfileId: string;
  /** Live install state by model id; absent means idle. */
  installs: Readonly<Record<string, InstallState>>;
  verifications: Readonly<Record<string, VerificationState>>;
  onSelect: (profile: VoiceProfile) => void;
  onPreview: (profile: VoiceProfile) => Promise<void>;
  onInstall: (modelId: string) => void;
  onVerify: (modelId: string) => void;
  /** Opens the full speaker list for models that carry more voices than presets. */
  onBrowseSpeakers: (modelId: string) => void;
};

const isInstalled = (model: VoiceModel): boolean => model.state.status === 'ready';

const megabytes = (bytes: number): number => Math.round(bytes / 1024 / 1024);

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
  installs,
  verifications,
  onSelect,
  onPreview,
  onInstall,
  onVerify,
  onBrowseSpeakers,
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

  /** Progress as text, because a download of this size needs to look alive. */
  const installLabel = (install: InstallState): string => {
    if (install.phase === 'failed') return t('settings.voice.installFailedShort');
    if (install.phase === 'extracting') return t('settings.voice.extracting');
    if (install.phase === 'validating') return t('settings.voice.validating');
    if (install.phase === 'pending' || install.downloadedBytes === 0) return t('settings.voice.installing');
    if (install.totalBytes) {
      const percent = Math.min(99, Math.floor((install.downloadedBytes / install.totalBytes) * 100));
      return `${percent}% · ${megabytes(install.downloadedBytes)}/${megabytes(install.totalBytes)}MB`;
    }
    return `${megabytes(install.downloadedBytes)}MB`;
  };

  return (
    <div className='flex flex-col gap-16px' data-testid='voice-picker'>
      {speechModels.map((model) => {
        const modelProfiles = profiles.filter((profile) => profile.modelId === model.id);
        if (modelProfiles.length === 0) return null;
        const installed = isInstalled(model);
        const install = installs[model.id];
        const verification = verifications[model.id];
        const busy = Boolean(install) && install.phase !== 'failed';

        return (
          <section key={model.id} data-testid={`voice-group-${model.id}`}>
            <header className='flex items-center gap-8px mb-8px flex-wrap'>
              <VolumeUp theme='outline' size='16' />
              <span className='text-13px font-500 text-t-primary'>{model.displayName}</span>
              <Tag size='small' color='arcoblue'>
                {t('settings.voice.local')}
              </Tag>

              {/* Models with more voices than presets get a pointer to the full
                  list, so the other 890-odd speakers are findable. */}
              {installed && modelProfiles.length > 1 && (
                <Tooltip content={t('settings.voice.moreVoicesHint')} mini>
                  <Button
                    type='text'
                    size='mini'
                    shape='circle'
                    aria-label={t('settings.voice.moreVoicesHint')}
                    data-testid={`voice-model-hint-${model.id}`}
                    icon={<Attention theme='outline' size='14' />}
                    onClick={() => onBrowseSpeakers(model.id)}
                  />
                </Tooltip>
              )}

              {(!installed || busy) && (
                <Button
                  size='mini'
                  type='primary'
                  data-testid={`voice-model-install-${model.id}`}
                  onClick={() => onInstall(model.id)}
                  loading={busy}
                  disabled={busy}
                  status={install?.phase === 'failed' ? 'danger' : undefined}
                >
                  {install ? installLabel(install) : t('settings.voice.install')}
                </Button>
              )}

              {/* Checks what is really on disk and that the engine can open it. */}
              <Button
                size='mini'
                data-testid={`voice-model-verify-${model.id}`}
                loading={verification === 'checking'}
                onClick={() => onVerify(model.id)}
              >
                {t('settings.voice.check')}
              </Button>

              {verification === 'usable' && (
                <span className='flex items-center gap-4px text-12px text-success' data-testid={`voice-ok-${model.id}`}>
                  <Check theme='outline' size='14' />
                  {t('settings.voice.checkUsable')}
                </span>
              )}
              {(verification === 'unusable' || verification === 'not-installed') && (
                <span className='flex items-center gap-4px text-12px text-danger' data-testid={`voice-bad-${model.id}`}>
                  <CloseOne theme='outline' size='14' />
                  {verification === 'not-installed'
                    ? t('settings.voice.notInstalled')
                    : t('settings.voice.checkBroken')}
                </span>
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

            {installed && modelProfiles.length > 1 && (
              <Button
                type='text'
                size='mini'
                className='mt-8px'
                data-testid={`voice-browse-${model.id}`}
                onClick={() => onBrowseSpeakers(model.id)}
              >
                {t('settings.voice.browseAllVoices')}
              </Button>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default VoicePicker;
