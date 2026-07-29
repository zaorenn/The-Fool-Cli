/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import {
  DEFAULT_FOOL_VOICE_SETTINGS,
  type FoolVoiceSettings,
  type VoicePcm16Wav,
  type VoiceTurnState,
} from '@/common/types/foolVoice';
import { AdaptiveVad } from '@renderer/services/voice/AdaptiveVad';
import { AudioPlaybackService } from '@renderer/services/voice/AudioPlaybackService';
import { MicrophoneCapture } from '@renderer/services/voice/MicrophoneCapture';

/** Dispatched with the transcript so the mounted SendBox owns submission. */
export const VOICE_SUBMIT_EVENT = 'fool:voice-submit';

export type VoiceSubmitDetail = { text: string };

export type FoolVoiceSession = {
  state: VoiceTurnState;
  /** Set when a required model is missing; the control offers install instead of starting. */
  missingModelId: string | null;
  isActive: boolean;
  start: () => Promise<void>;
  stop: () => void;
};

const idleState = (): VoiceTurnState => ({
  phase: 'idle',
  condition: { status: 'normal' },
  enteredAtMs: Date.now(),
});

const newOperationId = () => `voice-${crypto.randomUUID()}`;

/** `Omit` collapses a discriminated union, so distribute it across the members. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type VoiceTurnStateInput = DistributiveOmit<VoiceTurnState, 'enteredAtMs'>;

type ResponseEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string } };

const unwrap = <T>(envelope: ResponseEnvelope<T>): T => {
  if (envelope.ok === false) throw new Error(envelope.error.code);
  return envelope.data;
};

/**
 * Drives the hands-free loop:
 * listen -> silence ends the utterance -> transcribe -> submit -> speak -> listen.
 *
 * Speech detected during playback aborts it and opens the next capture, so the
 * user can interrupt without touching the keyboard.
 */
export const useFoolVoiceSession = (settings: FoolVoiceSettings = DEFAULT_FOOL_VOICE_SETTINGS): FoolVoiceSession => {
  const [state, setState] = useState<VoiceTurnState>(idleState);
  const [missingModelId, setMissingModelId] = useState<string | null>(null);

  const capture = useRef<MicrophoneCapture | null>(null);
  const playback = useRef<AudioPlaybackService | null>(null);
  const vad = useRef<AdaptiveVad | null>(null);
  const activeRef = useRef(false);
  const busyRef = useRef(false);

  const sessionId = useMemo(() => crypto.randomUUID(), []);

  const enter = useCallback((next: VoiceTurnStateInput) => {
    setState({ ...next, enteredAtMs: Date.now() } as VoiceTurnState);
  }, []);

  const listen = useCallback(() => {
    vad.current?.reset();
    capture.current?.beginUtterance();
    enter({
      phase: 'command-listening',
      sessionId,
      clientTurnId: crypto.randomUUID(),
      condition: { status: 'normal' },
    });
  }, [enter, sessionId]);

  const handleUtterance = useCallback(
    async (audio: VoicePcm16Wav) => {
      const operationId = newOperationId();
      enter({
        phase: 'transcribing',
        sessionId,
        operationId,
        purpose: 'command',
        clientTurnId: operationId,
        condition: { status: 'normal' },
      });

      const transcription = unwrap(
        await ipcBridge.foolVoice.transcribe.invoke({
          version: 1,
          requestId: operationId,
          payload: {
            operationId,
            providerId: settings.stt.providerId,
            modelId: settings.stt.modelId,
            languageHint: settings.stt.language,
            audio,
          },
        })
      );

      const text = transcription.text.trim();
      if (text.length === 0) {
        listen();
        return;
      }

      window.dispatchEvent(new CustomEvent<VoiceSubmitDetail>(VOICE_SUBMIT_EVENT, { detail: { text } }));
      listen();
    },
    [enter, listen, sessionId, settings.stt]
  );

  const onFrame = useCallback(
    ({ rms }: { rms: number }) => {
      if (!activeRef.current || !vad.current || !capture.current) return;

      const event = vad.current.push(rms, performance.now());

      // Barge-in: the user speaking cancels whatever is being said.
      if (event === 'speech-started') playback.current?.stop();

      if (event !== 'utterance-ended' && event !== 'utterance-truncated') return;
      if (busyRef.current) return;

      const audio = capture.current.takeUtteranceWav();
      capture.current.beginUtterance();
      if (!audio) return;

      busyRef.current = true;
      void handleUtterance(audio)
        .catch(() => {
          enter({
            phase: 'command-listening',
            sessionId,
            clientTurnId: crypto.randomUUID(),
            condition: { status: 'error', code: 'transcribe-failed', recoverable: true },
          });
        })
        .finally(() => {
          busyRef.current = false;
        });
    },
    [enter, handleUtterance, sessionId]
  );

  const stop = useCallback(() => {
    activeRef.current = false;
    busyRef.current = false;
    playback.current?.stop();
    capture.current?.stop();
    capture.current = null;
    vad.current = null;
    setState(idleState());
  }, []);

  const start = useCallback(async () => {
    if (activeRef.current) {
      stop();
      return;
    }

    // Refuse to start on a promise we cannot keep: check the models first.
    for (const modelId of [settings.stt.modelId, settings.tts.modelId]) {
      const health = unwrap(
        await ipcBridge.foolVoice.health.invoke({
          version: 1,
          requestId: newOperationId(),
          payload: { providerId: 'local-sherpa', modelId },
        })
      );
      if (health.status !== 'ready') {
        setMissingModelId(modelId);
        return;
      }
    }
    setMissingModelId(null);

    capture.current = new MicrophoneCapture();
    playback.current ??= new AudioPlaybackService();
    vad.current = new AdaptiveVad(settings.vad);

    await capture.current.start(settings.devices.inputDeviceId);
    capture.current.onFrame(onFrame);
    activeRef.current = true;
    listen();
  }, [listen, onFrame, settings.devices.inputDeviceId, settings.stt.modelId, settings.tts.modelId, settings.vad, stop]);

  useEffect(() => stop, [stop]);

  return { state, missingModelId, isActive: activeRef.current, start, stop };
};
