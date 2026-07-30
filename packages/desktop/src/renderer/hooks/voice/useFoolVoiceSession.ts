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
import { findWakePhrase } from '@renderer/services/voice/wakePhrase';

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
  /**
   * Listens for the wake phrase instead of treating speech as a command.
   *
   * Used by the always-on listener that runs while the desktop pet is up.
   */
  startWakeListening: () => Promise<void>;
  stop: () => void;
};

/**
 * How long the wake phrase keeps the session open for follow-up speech.
 *
 * Without a window the user would have to say the phrase before every sentence;
 * without a limit the microphone would treat a passing conversation as input.
 */
const AWAKE_WINDOW_MS = 25000;

/**
 * Longest utterance still checked for the wake phrase.
 *
 * The phrase can arrive inside a sentence, so this cannot be short — but there is
 * no reason to run minutes of background conversation through transcription.
 */
const MAX_WAKE_UTTERANCE_MS = 12000;

/** Tracks whether a hand-started session holds the microphone. */
let manualSessionActive = false;
const manualListeners = new Set<(active: boolean) => void>();

const setManualSessionActive = (active: boolean): void => {
  if (manualSessionActive === active) return;
  manualSessionActive = active;
  // Snapshot first: a listener may unsubscribe while being notified.
  for (const listener of Array.from(manualListeners)) listener(active);
};

/**
 * Notifies when a hand-started voice session takes or releases the microphone.
 *
 * The wake-word listener stands down while the user is deliberately talking, so
 * the two never open capture at the same time.
 */
export const subscribeManualVoiceSession = (listener: (active: boolean) => void): (() => void) => {
  manualListeners.add(listener);
  return () => {
    manualListeners.delete(listener);
  };
};

export const isManualVoiceSessionActive = (): boolean => manualSessionActive;

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
  /** True while this session is only waiting for the wake phrase. */
  const wakeModeRef = useRef(false);
  /** When the wake phrase's follow-up window closes. */
  const awakeUntilRef = useRef(0);
  const utteranceStartedAtRef = useRef(0);

  const sessionId = useMemo(() => crypto.randomUUID(), []);

  const enter = useCallback((next: VoiceTurnStateInput) => {
    setState({ ...next, enteredAtMs: Date.now() } as VoiceTurnState);
  }, []);

  const listen = useCallback(() => {
    vad.current?.reset();
    capture.current?.beginUtterance();
    utteranceStartedAtRef.current = Date.now();
    enter({
      phase: 'command-listening',
      sessionId,
      clientTurnId: crypto.randomUUID(),
      condition: { status: 'normal' },
    });
  }, [enter, sessionId]);

  /** Back to waiting for the phrase, with the microphone still open. */
  const listenForWake = useCallback(() => {
    vad.current?.reset();
    capture.current?.beginUtterance();
    utteranceStartedAtRef.current = Date.now();
    enter({ phase: 'wake-listening', sessionId, condition: { status: 'normal' } });
  }, [enter, sessionId]);

  const isAwake = useCallback(() => Date.now() < awakeUntilRef.current, []);

  const submit = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent<VoiceSubmitDetail>(VOICE_SUBMIT_EVENT, { detail: { text } }));
  }, []);

  const transcribe = useCallback(
    async (audio: VoicePcm16Wav, purpose: 'wake' | 'command'): Promise<string> => {
      const operationId = newOperationId();
      enter(
        purpose === 'wake'
          ? { phase: 'transcribing', sessionId, operationId, purpose: 'wake', condition: { status: 'normal' } }
          : {
              phase: 'transcribing',
              sessionId,
              operationId,
              purpose: 'command',
              clientTurnId: operationId,
              condition: { status: 'normal' },
            }
      );

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

      return transcription.text.trim();
    },
    [enter, sessionId, settings.stt]
  );

  const handleUtterance = useCallback(
    async (audio: VoicePcm16Wav, spokenMs: number) => {
      // Waiting for the phrase: transcribe, look for it, and stay quiet otherwise.
      if (wakeModeRef.current && !isAwake()) {
        if (spokenMs > MAX_WAKE_UTTERANCE_MS) {
          listenForWake();
          return;
        }

        const heard = await transcribe(audio, 'wake');
        const match = heard.length > 0 ? findWakePhrase(heard, settings.activation.wakePhrase.phrase) : null;
        if (!match) {
          listenForWake();
          return;
        }

        awakeUntilRef.current = Date.now() + AWAKE_WINDOW_MS;
        enter({
          phase: 'wake-detected',
          sessionId,
          matchedPhrase: settings.activation.wakePhrase.phrase,
          condition: { status: 'normal' },
        });

        // "wake up fool, run the tests" should not need saying twice.
        if (match.commandText.length > 0) submit(match.commandText);
        listen();
        return;
      }

      const text = await transcribe(audio, 'command');
      if (text.length === 0) {
        if (wakeModeRef.current && !isAwake()) listenForWake();
        else listen();
        return;
      }

      // Each exchange extends the window, so a conversation does not need the
      // phrase again between turns.
      if (wakeModeRef.current) awakeUntilRef.current = Date.now() + AWAKE_WINDOW_MS;

      submit(text);
      listen();
    },
    [enter, isAwake, listen, listenForWake, sessionId, settings.activation.wakePhrase.phrase, submit, transcribe]
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
      const spokenMs = Date.now() - utteranceStartedAtRef.current;
      capture.current.beginUtterance();
      utteranceStartedAtRef.current = Date.now();
      if (!audio) return;

      busyRef.current = true;
      void handleUtterance(audio, spokenMs)
        .catch(() => {
          // A failed transcription must not end an always-on listener; drop back
          // to whichever mode this session is in.
          if (wakeModeRef.current && !isAwake()) {
            enter({
              phase: 'wake-listening',
              sessionId,
              condition: { status: 'error', code: 'transcribe-failed', recoverable: true },
            });
            return;
          }
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
    [enter, handleUtterance, isAwake, sessionId]
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
          if (!activeRef.current) return;
          // An always-on listener whose follow-up window has closed goes back to
          // waiting for the phrase rather than treating the room as input.
          if (wakeModeRef.current && !isAwake()) listenForWake();
          else listen();
        });
    },
    [isAwake, listen, listenForWake, speak]
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
    const wasManual = activeRef.current && !wakeModeRef.current;
    activeRef.current = false;
    busyRef.current = false;
    wakeModeRef.current = false;
    awakeUntilRef.current = 0;
    playback.current?.stop();
    capture.current?.stop();
    capture.current = null;
    vad.current = null;
    if (wasManual) setManualSessionActive(false);
    setState(idleState());
  }, []);

  /**
   * Checks the models, then opens capture and playback.
   *
   * Returns false when a required model is missing, so neither entry point starts
   * on a promise it cannot keep. Speech output is only required for a session
   * that will talk back — the wake listener just needs to hear.
   */
  const openMicrophone = useCallback(
    async (options: { requireSpeechOutput: boolean }): Promise<boolean> => {
      const required = options.requireSpeechOutput
        ? [settings.stt.modelId, settings.tts.modelId]
        : [settings.stt.modelId];

      for (const modelId of required) {
        const health = unwrap(
          await ipcBridge.foolVoice.health.invoke({
            version: 1,
            requestId: newOperationId(),
            payload: { providerId: 'local-sherpa', modelId },
          })
        );
        if (health.status !== 'ready') {
          setMissingModelId(modelId);
          return false;
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
      playback.current.setOutputDevice(settings.devices.outputDeviceId);
      vad.current = new AdaptiveVad(settings.vad);

      await capture.current.start(settings.devices.inputDeviceId);
      capture.current.onFrame(onFrame);
      activeRef.current = true;
      return true;
    },
    [
      onFrame,
      settings.devices.inputDeviceId,
      settings.devices.outputDeviceId,
      settings.stt.modelId,
      settings.tts.modelId,
      settings.vad,
    ]
  );

  const start = useCallback(async () => {
    if (activeRef.current) {
      stop();
      return;
    }

    if (!(await openMicrophone({ requireSpeechOutput: true }))) return;

    wakeModeRef.current = false;
    // Started by hand, so no phrase is needed before the first sentence.
    awakeUntilRef.current = Date.now() + AWAKE_WINDOW_MS;
    setManualSessionActive(true);
    listen();
  }, [listen, openMicrophone, stop]);

  const startWakeListening = useCallback(async () => {
    // Already listening, or the user is deliberately talking: leave the
    // microphone where it is.
    if (activeRef.current || manualSessionActive) return;

    if (!(await openMicrophone({ requireSpeechOutput: false }))) return;

    wakeModeRef.current = true;
    awakeUntilRef.current = 0;
    listenForWake();
  }, [listenForWake, openMicrophone]);

  useEffect(() => stop, [stop]);

  return { state, missingModelId, isActive: activeRef.current, start, startWakeListening, stop };
};
