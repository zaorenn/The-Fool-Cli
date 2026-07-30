/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Message, Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { FoolVoiceSettings } from '@/common/types/foolVoice';
import { AudioPlaybackService } from '@renderer/services/voice/AudioPlaybackService';
import { MicrophoneCapture } from '@renderer/services/voice/MicrophoneCapture';

export type AudioDeviceSectionProps = {
  devices: FoolVoiceSettings['devices'];
  volume: number;
  onChange: (devices: FoolVoiceSettings['devices']) => void;
};

/** Frames are ~8/s at 16 kHz; a short decay keeps the meter readable. */
const METER_DECAY = 0.82;
const SYSTEM_DEFAULT_VALUE = '__system-default__';

/**
 * Microphone and speaker selection that can be proved, not just claimed.
 *
 * Each picker has a test next to it: the microphone shows a live level while it
 * is listening and the speaker plays a tone through the chosen device, so a
 * device that is selected but not actually working is immediately obvious.
 */
const AudioDeviceSection: React.FC<AudioDeviceSectionProps> = ({ devices, volume, onChange }) => {
  const { t } = useTranslation();
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [level, setLevel] = useState(0);
  const [listening, setListening] = useState(false);
  const [testingSpeaker, setTestingSpeaker] = useState(false);

  const capture = useRef<MicrophoneCapture | null>(null);
  const playback = useRef<AudioPlaybackService | null>(null);

  const loadDevices = useCallback(async () => {
    try {
      try {
        // Labels stay empty until capture has been permitted once, so ask first
        // and release immediately.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        setPermissionDenied(false);
      } catch {
        setPermissionDenied(true);
      }

      const found = await navigator.mediaDevices.enumerateDevices();
      setInputDevices(found.filter((device) => device.kind === 'audioinput'));
      setOutputDevices(found.filter((device) => device.kind === 'audiooutput'));
    } catch {
      setInputDevices([]);
      setOutputDevices([]);
    }
  }, []);

  useEffect(() => {
    void loadDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', loadDevices);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', loadDevices);
  }, [loadDevices]);

  const stopListening = useCallback(() => {
    capture.current?.stop();
    capture.current = null;
    setListening(false);
    setLevel(0);
  }, []);

  // Never leave the microphone open behind a closed settings page.
  useEffect(() => stopListening, [stopListening]);

  const startListening = useCallback(async () => {
    const microphone = new MicrophoneCapture();
    capture.current = microphone;
    try {
      await microphone.start(devices.inputDeviceId);
    } catch {
      capture.current = null;
      Message.error(t('settings.voice.microphoneUnavailable'));
      return;
    }
    // rms of speech sits around 0.05–0.3, so scale before clamping.
    microphone.onFrame(({ rms }) => setLevel((previous) => Math.max(rms * 4, previous * METER_DECAY)));
    setListening(true);
  }, [devices.inputDeviceId, t]);

  const handleMicrophoneTest = useCallback(() => {
    if (listening) {
      stopListening();
      return;
    }
    void startListening();
  }, [listening, startListening, stopListening]);

  const handleSpeakerTest = useCallback(() => {
    playback.current ??= new AudioPlaybackService();
    playback.current.setOutputDevice(devices.outputDeviceId);
    setTestingSpeaker(true);
    void playback.current
      .playTone({ volume })
      .catch(() => Message.error(t('settings.voice.speakerUnavailable')))
      .finally(() => setTestingSpeaker(false));
  }, [devices.outputDeviceId, t, volume]);

  const options = (list: MediaDeviceInfo[]) => [
    { label: t('settings.voice.systemDefault'), value: SYSTEM_DEFAULT_VALUE },
    ...list.map((device) => ({ label: device.label || device.deviceId, value: device.deviceId })),
  ];

  return (
    <div className='flex flex-col gap-16px'>
      <label className='flex flex-col gap-6px'>
        <span className='text-13px text-t-secondary'>{t('settings.voice.microphone')}</span>
        <div className='flex gap-8px items-center'>
          <Select
            className='flex-1'
            data-testid='voice-input-device'
            value={devices.inputDeviceId ?? SYSTEM_DEFAULT_VALUE}
            onChange={(value: string) => {
              // Re-open capture on the new device if the meter is running.
              if (listening) stopListening();
              onChange({ ...devices, inputDeviceId: value === SYSTEM_DEFAULT_VALUE ? null : value });
            }}
            options={options(inputDevices)}
          />
          <Button data-testid='voice-input-test' onClick={handleMicrophoneTest}>
            {listening ? t('settings.voice.stopTest') : t('settings.voice.testMicrophone')}
          </Button>
        </div>
        {listening && (
          <span className='h-6px rounded-3px bg-fill-2 overflow-hidden' data-testid='voice-input-level'>
            <span
              className='block h-full bg-primary transition-[width] duration-100'
              style={{ width: `${Math.round(Math.min(1, level) * 100)}%` }}
            />
          </span>
        )}
        {permissionDenied && <span className='text-12px text-warning'>{t('settings.voice.microphoneBlocked')}</span>}
      </label>

      <label className='flex flex-col gap-6px'>
        <span className='text-13px text-t-secondary'>{t('settings.voice.speaker')}</span>
        <div className='flex gap-8px items-center'>
          <Select
            className='flex-1'
            data-testid='voice-output-device'
            value={devices.outputDeviceId ?? SYSTEM_DEFAULT_VALUE}
            onChange={(value: string) =>
              onChange({ ...devices, outputDeviceId: value === SYSTEM_DEFAULT_VALUE ? null : value })
            }
            options={options(outputDevices)}
          />
          <Button data-testid='voice-output-test' loading={testingSpeaker} onClick={handleSpeakerTest}>
            {t('settings.voice.testSpeaker')}
          </Button>
        </div>
      </label>
    </div>
  );
};

export default AudioDeviceSection;
