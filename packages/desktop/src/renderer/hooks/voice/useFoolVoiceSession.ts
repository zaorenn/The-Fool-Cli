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
import { EMPTY_EVIDENCE, narrate, type RunEvidence } from '@renderer/services/voice/FoolNarrator';
import { createRunEvidenceCollector } from '@renderer/services/voice/RunEvidenceCollector';
import { selectTtsTarget } from '@renderer/services/voice/selectTtsTarget';

/** Dispatched with the transcript so the mounted SendBox owns submission. */
export const VOICE_SUBMIT_EVENT = 'fool:voice-submit';

/**
 * Dispatched by the conversation when a turn finishes, carrying the answer and
 * the run evidence the spoken brief is built from.
 */
export const VOICE_REPLY_EVENT = 'fool:voice-reply';

export type VoiceSubmitDetail = { text: string };

export type VoiceReplyDetail = { answer: string; evidence?: RunEvidence };

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
  /** Which TTS models are installed, so a Turkish reply can pick a Turkish voice. */
  const installedModelIdsRef = useRef<string[]>([]);

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

  const speak = useCallback(
    async (answer: string, evidence: RunEvidence): Promise<void> => {
      const narration = narrate(answer, evidence, {
        language: settings.narrator.language,
        maxSpokenCharacters: settings.narrator.maxSpokenCharacters,
      });
      if (narration.spokenText.length === 0) return;

      const installed = installedModelIdsRef.current;
      const target = selectTtsTarget(narration.spokenText, settings, installed);
      const operationId = newOperationId();

      enter({
        phase: 'speaking',
        sessionId,
        conversationId: sessionId,
        turnId: operationId,
        operationId,
        condition: { status: 'normal' },
      });

      const synthesis = unwrap(
        await ipcBridge.foolVoice.synthesize.invoke({
          version: 1,
          requestId: operationId,
          payload: {
            operationId,
            providerId: settings.tts.providerId,
            modelId: target.modelId,
            profileId: target.profileId,
            language: target.language,
            speed: settings.tts.speed,
            text: narration.spokenText,
          },
        })
      );

      await playback.current?.play(synthesis.audio);
    },
    [enter, sessionId, settings]
  );

  const speakThenListen = useCallback(
    (answer: string, evidence: RunEvidence): void => {
      if (!activeRef.current) return;

      void speak(answer, evidence)
        .catch((): void => {
          // A synthesis failure must not end the session; keep listening.
        })
        .finally((): void => {
          if (activeRef.current) listen();
        });
    },
    [listen, speak]
  );

  // Turn completion arrives on the conversation's existing response stream.
  // Subscribing here — rather than adding a second detection path — keeps the
  // spoken brief in step with what the screen already shows.
  useEffect(() => {
    const collector = createRunEvidenceCollector(({ answer, evidence }) => speakThenListen(answer, evidence));
    const disposeStream = ipcBridge.conversation?.responseStream?.on(collector.onStreamMessage);

    // Also honoured directly, so a caller can drive speech in tests or from a
    // surface that is not the conversation stream.
    const handleReply = (event: Event) => {
      const { answer, evidence } = (event as CustomEvent<VoiceReplyDetail>).detail;
      speakThenListen(answer, evidence ?? EMPTY_EVIDENCE);
    };
    window.addEventListener(VOICE_REPLY_EVENT, handleReply);

    return () => {
      disposeStream?.();
      collector.reset();
      window.removeEventListener(VOICE_REPLY_EVENT, handleReply);
    };
  }, [speakThenListen]);

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

    const catalog = unwrap(
      await ipcBridge.foolVoice.catalog.invoke({
        version: 1,
        requestId: newOperationId(),
        payload: { includeProfiles: false },
      })
    );
    installedModelIdsRef.current = catalog.models
      .filter((model) => model.state.status === 'ready')
      .map((model) => model.id);

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
