/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Switch, Tag } from '@arco-design/web-react';
import { Check, CloseOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import {
  PUSH_TO_TALK_DEFAULT,
  type FoolVoiceSettings,
  type VoiceModel,
  type VoicePcm16Wav,
} from '@/common/types/foolVoice';
import { AdaptiveVad } from '@renderer/services/voice/AdaptiveVad';
import { MicrophoneCapture } from '@renderer/services/voice/MicrophoneCapture';
import { findWakePhrase } from '@renderer/services/voice/wakePhrase';

export type WakeWordSectionProps = {
  settings: FoolVoiceSettings;
  /** The transcription model that will do the hearing, as the catalog reports it. */
  listenModel: VoiceModel | undefined;
  onChange: (change: (previous: FoolVoiceSettings) => FoolVoiceSettings) => void;
  /** Opens the install flow for the model the wake word needs. */
  onInstallModel: () => void;
};

type TestState =
  | { status: 'idle' }
  | { status: 'listening' }
  | { status: 'transcribing' }
  | { status: 'matched'; heard: string }
  | { status: 'missed'; heard: string }
  | { status: 'silent' }
  | { status: 'failed' };

/** Long enough for a phrase and a breath, short enough not to feel stuck. */
const TEST_TIMEOUT_MS = 7000;
const MIN_PHRASE_LENGTH = 2;

const newRequestId = () => `wake-test-${crypto.randomUUID()}`;

/** What the desktop reported about the shortcut the last time it was claimed. */
type ShortcutState = 'idle' | 'checking' | 'registered' | 'taken' | 'invalid';

/**
 * The two ways a spoken turn starts, and a way to prove each of them.
 *
 * Typing a phrase here changes what the listener waits for — it is the same
 * stored value the always-on listener reads, and it restarts on a change. The
 * check is the honest part: it opens the microphone, waits for one utterance,
 * runs it through the same transcription model and the same matcher the listener
 * uses, and reports what it heard and whether that counted.
 *
 * The shortcut is the other way in, for when the wake word is off or the room is
 * loud, and it has the same problem: a key another application already holds
 * registers as silence. So it is claimed on demand and the answer is shown. Both
 * failures are therefore visible here rather than at 2am with the pet ignoring
 * you.
 */
const WakeWordSection: React.FC<WakeWordSectionProps> = ({ settings, listenModel, onChange, onInstallModel }) => {
  const { t } = useTranslation();
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [shortcut, setShortcut] = useState<ShortcutState>('idle');
  const capture = useRef<MicrophoneCapture | null>(null);
  const timer = useRef<number | null>(null);

  const accelerator = settings.activation.pushToTalkShortcut;

  // Typing a new key does not claim it; the answer to "is this one free" only
  // means anything once it has been asked for.
  useEffect(() => setShortcut('idle'), [accelerator]);

  /**
   * Asks the desktop for the key and says what came back.
   *
   * A shortcut another application already holds registers silently as nothing at
   * all, which is the failure that would otherwise be found at 2am.
   */
  const claim = useCallback(async () => {
    setShortcut('checking');
    try {
      const response = await ipcBridge.foolVoice.shortcut.invoke({
        version: 1,
        requestId: newRequestId(),
        payload: { accelerator },
      });
      if (response.ok === false) {
        setShortcut('invalid');
        return;
      }
      if (response.data.registered) {
        setShortcut('registered');
        return;
      }
      setShortcut(response.data.reason === 'taken' ? 'taken' : 'invalid');
    } catch {
      setShortcut('invalid');
    }
  }, [accelerator]);

  const phrase = settings.activation.wakePhrase.phrase;
  const modelReady = listenModel?.state.status === 'ready';
  const phraseTooShort = phrase.trim().length < MIN_PHRASE_LENGTH;

  const cleanup = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    capture.current?.stop();
    capture.current = null;
  }, []);

  // Never leave the microphone open behind a closed page.
  useEffect(() => cleanup, [cleanup]);

  const transcribe = useCallback(
    async (audio: VoicePcm16Wav): Promise<string> => {
      const requestId = newRequestId();
      const response = await ipcBridge.foolVoice.transcribe.invoke({
        version: 1,
        requestId,
        payload: {
          operationId: requestId,
          providerId: settings.stt.providerId,
          modelId: settings.stt.modelId,
          languageHint: settings.stt.language,
          audio,
        },
      });
      if (response.ok === false) throw new Error(response.error.code);
      return response.data.text.trim();
    },
    [settings.stt]
  );

  const runTest = useCallback(async () => {
    cleanup();
    setTest({ status: 'listening' });

    const microphone = new MicrophoneCapture();
    const vad = new AdaptiveVad(settings.vad);
    capture.current = microphone;

    try {
      await microphone.start(settings.devices.inputDeviceId);
    } catch {
      cleanup();
      setTest({ status: 'failed' });
      return;
    }

    let finished = false;
    const finish = async (audio: VoicePcm16Wav | null) => {
      if (finished) return;
      finished = true;
      cleanup();

      if (!audio) {
        setTest({ status: 'silent' });
        return;
      }

      setTest({ status: 'transcribing' });
      try {
        const heard = await transcribe(audio);
        if (heard.length === 0) {
          setTest({ status: 'silent' });
          return;
        }
        setTest(findWakePhrase(heard, phrase) ? { status: 'matched', heard } : { status: 'missed', heard });
      } catch {
        setTest({ status: 'failed' });
      }
    };

    microphone.beginUtterance();
    microphone.onFrame(({ rms }) => {
      const event = vad.push(rms, performance.now());
      if (event === 'utterance-ended' || event === 'utterance-truncated') {
        void finish(microphone.takeUtteranceWav());
      }
    });

    // A speaker who says nothing should still get an answer.
    timer.current = window.setTimeout(() => {
      void finish(microphone.takeUtteranceWav());
    }, TEST_TIMEOUT_MS);
  }, [cleanup, phrase, settings.devices.inputDeviceId, settings.vad, transcribe]);

  const testing = test.status === 'listening' || test.status === 'transcribing';

  const result = (): React.ReactNode => {
    switch (test.status) {
      case 'listening':
        return <span className='text-12px text-t-secondary'>{t('settings.voice.wakeTestSpeakNow', { phrase })}</span>;
      case 'transcribing':
        return <span className='text-12px text-t-secondary'>{t('settings.voice.wakeTestChecking')}</span>;
      case 'matched':
        return (
          <span className='flex items-center gap-4px text-12px text-success' data-testid='wake-test-matched'>
            <Check theme='outline' size='14' />
            {t('settings.voice.wakeTestMatched', { heard: test.heard })}
          </span>
        );
      case 'missed':
        return (
          <span className='flex items-center gap-4px text-12px text-warning' data-testid='wake-test-missed'>
            <CloseOne theme='outline' size='14' />
            {t('settings.voice.wakeTestMissed', { heard: test.heard })}
          </span>
        );
      case 'silent':
        return <span className='text-12px text-warning'>{t('settings.voice.wakeTestSilent')}</span>;
      case 'failed':
        return <span className='text-12px text-danger'>{t('settings.voice.wakeTestFailed')}</span>;
      default:
        return null;
    }
  };

  return (
    <div className='flex flex-col gap-12px'>
      <label className='flex items-center justify-between gap-12px'>
        <span className='text-13px text-t-secondary'>{t('settings.voice.wakeWordEnabled')}</span>
        <Switch
          data-testid='voice-wake-enabled'
          checked={settings.activation.wakePhrase.enabled}
          onChange={(checked: boolean) =>
            onChange((previous) => ({
              ...previous,
              activation: {
                ...previous.activation,
                wakePhrase: { ...previous.activation.wakePhrase, enabled: checked },
              },
            }))
          }
        />
      </label>

      <label className='flex flex-col gap-4px'>
        <span className='text-13px text-t-secondary'>{t('settings.voice.wakePhrase')}</span>
        <div className='flex gap-8px items-center'>
          <Input
            className='flex-1'
            data-testid='voice-wake-phrase'
            value={phrase}
            maxLength={64}
            onChange={(value: string) =>
              onChange((previous) => ({
                ...previous,
                activation: {
                  ...previous.activation,
                  wakePhrase: { ...previous.activation.wakePhrase, phrase: value.slice(0, 64) },
                },
              }))
            }
          />
          <Button
            data-testid='voice-wake-test'
            loading={testing}
            disabled={testing || !modelReady || phraseTooShort}
            onClick={() => void runTest()}
          >
            {t('settings.voice.check')}
          </Button>
        </div>
      </label>

      {result()}

      {phraseTooShort && <span className='text-12px text-warning'>{t('settings.voice.wakePhraseTooShort')}</span>}

      {/* The wake word hears through the transcription model, so say which one and
          offer to install it right here rather than sending the user hunting. */}
      <div className='flex items-center gap-8px flex-wrap'>
        <span className='text-12px text-t-secondary'>{t('settings.voice.wakeWordModel')}</span>
        <Tag size='small' color={modelReady ? 'green' : 'red'}>
          {listenModel?.displayName ?? settings.stt.modelId}
        </Tag>
        {!modelReady && (
          <Button size='mini' type='primary' data-testid='voice-wake-install' onClick={onInstallModel}>
            {t('settings.voice.install')}
          </Button>
        )}
      </div>

      <span className='text-12px text-t-secondary'>{t('settings.voice.wakeWordPetHint')}</span>
      {settings.activation.wakePhrase.enabled && !modelReady && (
        <span className='text-12px text-warning' data-testid='voice-wake-needs-model'>
          {t('settings.voice.wakeWordNeedsModel')}
        </span>
      )}

      {/* The other way to start a turn: a key that works with the app behind
          everything else, for when the wake word is off or the room is loud. */}
      <label className='flex flex-col gap-4px'>
        <span className='text-13px text-t-secondary'>{t('settings.voice.shortcut')}</span>
        <div className='flex gap-8px items-center'>
          <Input
            className='flex-1'
            data-testid='voice-shortcut'
            value={settings.activation.pushToTalkShortcut}
            maxLength={64}
            placeholder={PUSH_TO_TALK_DEFAULT}
            onChange={(value: string) =>
              onChange((previous) => ({
                ...previous,
                activation: { ...previous.activation, pushToTalkShortcut: value.slice(0, 64) },
              }))
            }
          />
          <Button
            data-testid='voice-shortcut-check'
            loading={shortcut === 'checking'}
            // Nothing to claim, and nothing to report about it.
            disabled={accelerator.trim().length === 0 || shortcut === 'checking'}
            onClick={() => void claim()}
          >
            {t('settings.voice.check')}
          </Button>
        </div>
      </label>
      {shortcut === 'registered' && (
        <span className='text-12px text-success' data-testid='voice-shortcut-ok'>
          {t('settings.voice.shortcutRegistered')}
        </span>
      )}
      {shortcut === 'taken' && (
        <span className='text-12px text-danger' data-testid='voice-shortcut-taken'>
          {t('settings.voice.shortcutTaken')}
        </span>
      )}
      {shortcut === 'invalid' && (
        <span className='text-12px text-danger' data-testid='voice-shortcut-invalid'>
          {t('settings.voice.shortcutInvalid')}
        </span>
      )}
      <span className='text-12px text-t-secondary'>{t('settings.voice.shortcutHint')}</span>
    </div>
  );
};

export default WakeWordSection;
