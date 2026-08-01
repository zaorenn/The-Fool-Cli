/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import { Button, Input, Message, Spin, Upload } from '@arco-design/web-react';
import { Check, CloseOne, Microphone } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { CLONING_MODEL_IDS, cloningRequiresTranscript, type VoiceModel } from '@/common/types/foolVoice';
import { decodeAudioFileForCloning } from '@renderer/services/voice/decodeAudioFileForCloning';
import { toBase64 } from '@renderer/services/voice/MicrophoneCapture';
import { verifyVoiceModel } from './voiceModelActions';

export type CloneVoiceUploadProps = {
  /** Where an installed transcription model, if any, is found. */
  models: readonly VoiceModel[];
  /**
   * The voice currently selected, so a saved clone is proved on the engine that
   * is about to speak it rather than on whichever cloning engine comes first.
   */
  preferredModelId?: string;
  /** Called once the voice is saved, so the caller re-reads the catalog and
   * the new voice appears in the picker. */
  onSaved: () => void;
};

type Stage =
  | { step: 'idle' }
  | { step: 'decoding' }
  | { step: 'review'; wav: ArrayBuffer; durationSec: number; displayName: string; referenceText: string }
  | { step: 'saving'; wav: ArrayBuffer; displayName: string; referenceText: string }
  /** `usable` is null when there was no engine installed to prove it on. */
  | { step: 'done'; displayName: string; usable: boolean | null };

/** `Name of the file.wav` → `name-of-the-file`, and never empty. */
const slugify = (value: string): string => {
  const slug = value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug.slice(0, 64) : `voice-${Date.now()}`;
};

const newOperationId = () => `clone-${crypto.randomUUID()}`;

const unwrap = <T,>(envelope: { ok: true; data: T } | { ok: false; error: { code: string } }): T => {
  if (envelope.ok === false) throw new Error(envelope.error.code);
  return envelope.data;
};

/**
 * Cloning a voice from a file the user already has, rather than the manual
 * "record with a microphone" flow this sits next to.
 *
 * Nothing here re-encodes for the sake of it: the same 24 kHz decode both
 * becomes the saved reference and is what plays back in the browser's own
 * audio element for a quick listen, and a second, separate 16 kHz decode of
 * the same file (not a downsample of the first) is what the transcription
 * bridge accepts — it validates exactly 16 kHz, no other rate.
 */
const CloneVoiceUpload: React.FC<CloneVoiceUploadProps> = ({ models, preferredModelId, onSaved }) => {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>({ step: 'idle' });

  const installedSttModel = models.find((model) => model.role === 'speech-to-text' && model.state.status === 'ready');

  // The engine the new clone is proved on. There are three that can render one
  // and the recording is offered to all of them, so this is only about which
  // one the "Save & Verify" check runs through — the selected voice if it can
  // clone, otherwise any installed cloning engine.
  const verifyModel =
    models.find(
      (model) => model.id === preferredModelId && CLONING_MODEL_IDS.includes(model.id) && model.state.status === 'ready'
    ) ?? models.find((model) => CLONING_MODEL_IDS.includes(model.id) && model.state.status === 'ready');

  // Only ZipVoice ever aligned the new text against what the clip says. None of
  // the engines a clone is offered to now reads a transcript, so asking for one
  // would be asking the user to type something nothing will look at — and on a
  // machine with no transcription model installed, to type it by hand.
  const transcriptRequired = verifyModel ? cloningRequiresTranscript(verifyModel.id) : false;

  const handleFile = useCallback(
    async (file: File) => {
      setStage({ step: 'decoding' });
      try {
        const reference = await decodeAudioFileForCloning(file, 24000);

        let referenceText = '';
        if (installedSttModel) {
          const capture = await decodeAudioFileForCloning(file, 16000);
          const transcribed = unwrap(
            await ipcBridge.foolVoice.transcribe.invoke({
              version: 1,
              requestId: newOperationId(),
              payload: {
                operationId: newOperationId(),
                providerId: 'local-sherpa',
                modelId: installedSttModel.id,
                languageHint: 'auto',
                audio: {
                  encoding: 'base64',
                  mimeType: 'audio/wav',
                  sampleRateHz: 16000,
                  channels: 1,
                  sampleFormat: 'pcm16le',
                  byteLength: capture.wav.byteLength,
                  dataBase64: toBase64(capture.wav),
                },
              },
            })
          );
          referenceText = transcribed.text;
        }

        setStage({
          step: 'review',
          wav: reference.wav,
          durationSec: reference.durationSec,
          displayName: slugify(file.name).replace(/-/g, ' '),
          referenceText,
        });
      } catch {
        Message.error(t('settings.voice.cloneDecodeFailed'));
        setStage({ step: 'idle' });
      }
    },
    [installedSttModel, t]
  );

  const handleSave = useCallback(async () => {
    if (stage.step !== 'review') return;
    const { wav, displayName, referenceText } = stage;
    setStage({ step: 'saving', wav, displayName, referenceText });

    const voiceId = slugify(displayName);
    try {
      const saved = unwrap(
        await ipcBridge.foolVoice.cloneVoice.invoke({
          version: 1,
          requestId: newOperationId(),
          payload: {
            operationId: newOperationId(),
            voiceId,
            displayName,
            languages: ['en'],
            referenceText,
            audio: {
              encoding: 'base64',
              mimeType: 'audio/wav',
              sampleRateHz: 24000,
              channels: 1,
              sampleFormat: 'pcm16le',
              byteLength: wav.byteLength,
              dataBase64: toBase64(wav),
            },
          },
        })
      );

      onSaved();

      // Saved either way. With no cloning engine installed there is nothing to
      // prove it on yet, which is a different answer from "it does not work" —
      // the recording is on disk and speaks as soon as an engine arrives.
      const result = verifyModel ? await verifyVoiceModel(verifyModel, saved.profileId) : null;
      setStage({ step: 'done', displayName, usable: result === null ? null : result.status === 'usable' });
    } catch {
      Message.error(t('settings.voice.cloneSaveFailed'));
      setStage({ step: 'review', wav, durationSec: 0, displayName, referenceText });
    }
  }, [stage, verifyModel, onSaved, t]);

  if (stage.step === 'done') {
    return (
      <div className='flex items-center gap-8px py-8px' data-testid='clone-voice-done'>
        {stage.usable === null && (
          <span className='flex items-center gap-4px text-13px text-t-secondary'>
            <Check theme='outline' size='14' />
            {t('settings.voice.cloneSavedNoEngine', { name: stage.displayName })}
          </span>
        )}
        {stage.usable === true && (
          <span className='flex items-center gap-4px text-13px text-success'>
            <Check theme='outline' size='14' />
            {t('settings.voice.cloneSavedUsable', { name: stage.displayName })}
          </span>
        )}
        {stage.usable === false && (
          <span className='flex items-center gap-4px text-13px text-danger'>
            <CloseOne theme='outline' size='14' />
            {t('settings.voice.cloneSavedUnusable', { name: stage.displayName })}
          </span>
        )}
        <Button size='mini' onClick={() => setStage({ step: 'idle' })}>
          {t('settings.voice.cloneAnother')}
        </Button>
      </div>
    );
  }

  if (stage.step === 'review' || stage.step === 'saving') {
    const saving = stage.step === 'saving';
    return (
      <div className='flex flex-col gap-8px py-8px' data-testid='clone-voice-review'>
        <Input
          size='small'
          value={stage.displayName}
          placeholder={t('settings.voice.cloneNamePlaceholder')}
          disabled={saving}
          onChange={(value) => setStage({ ...stage, displayName: value })}
        />
        <Input.TextArea
          value={stage.referenceText}
          placeholder={t(
            transcriptRequired ? 'settings.voice.cloneTextPlaceholder' : 'settings.voice.cloneTextOptional'
          )}
          disabled={saving}
          autoSize={{ minRows: 2, maxRows: 4 }}
          onChange={(value) => setStage({ ...stage, referenceText: value })}
        />
        <div className='flex items-center gap-8px'>
          <Button
            size='mini'
            type='primary'
            loading={saving}
            disabled={
              (transcriptRequired && stage.referenceText.trim().length === 0) || stage.displayName.trim().length === 0
            }
            onClick={handleSave}
          >
            {t('settings.voice.cloneSaveAndVerify')}
          </Button>
          <Button size='mini' disabled={saving} onClick={() => setStage({ step: 'idle' })}>
            {t('settings.voice.cloneCancel')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Upload
      drag
      accept='audio/*'
      showUploadList={false}
      disabled={stage.step === 'decoding'}
      customRequest={({ file, onSuccess, onError }) => {
        void handleFile(file as unknown as File)
          .then(() => onSuccess())
          .catch((error: unknown) => onError(error as object));
      }}
    >
      <div
        className='flex items-center gap-8px py-16px px-12px text-13px text-t-tertiary'
        data-testid='clone-voice-dropzone'
      >
        {stage.step === 'decoding' ? <Spin size={14} /> : <Microphone theme='outline' size='16' />}
        {t(stage.step === 'decoding' ? 'settings.voice.cloneDecoding' : 'settings.voice.cloneDropHint')}
      </div>
    </Upload>
  );
};

export default CloneVoiceUpload;
