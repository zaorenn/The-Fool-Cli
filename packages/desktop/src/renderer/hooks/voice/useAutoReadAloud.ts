/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { ipcBridge } from '@/common';
import { getSpeechPlayer, stopSpeech } from '@renderer/services/voice/speechPlayer';
import { createRunEvidenceCollector } from '@renderer/services/voice/RunEvidenceCollector';
import { speakText } from '@renderer/services/voice/speakText';
import { isManualVoiceSessionActive, subscribeManualVoiceSession } from '@renderer/hooks/voice/useFoolVoiceSession';
import { peekWakeListenerState, subscribeWakeListener } from '@renderer/hooks/voice/useWakeWordListener';
import { useFoolVoiceSettings } from '@renderer/hooks/voice/useFoolVoiceSettings';

/**
 * Reads every finished reply aloud, for turns that were typed.
 *
 * The hands-free loop already speaks its own answers — it has to, because
 * nobody is looking at the screen. This is the same courtesy for the rest of the
 * app, and it stays out of the loop's way: while a spoken session holds the
 * microphone this does nothing at all, because two readers of the same reply
 * would talk over each other.
 *
 * Mounted once by the app root; it renders nothing.
 */

/** Longest reply read automatically, so one turn cannot talk for minutes. */
const MAX_SPOKEN_CHARACTERS = 1200;

export const useAutoReadAloud = (): void => {
  const { settings } = useFoolVoiceSettings();
  /** True while the voice session owns speech, so this must stay quiet. */
  const sessionActive = useRef(isManualVoiceSessionActive());
  /**
   * True only while a spoken turn is actually in flight.
   *
   * Not "the microphone is open": the wake listener holds it for as long as the
   * desktop pet is up, which is all day. Standing down for that silenced
   * automatic reading entirely — the thing it was switched on to do. A wake
   * session that is merely waiting for the phrase has no answer of its own to
   * speak, so there is nothing to collide with.
   */
  const voiceTurnRunning = useRef(peekWakeListenerState() === 'awake');

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => subscribeManualVoiceSession((active) => (sessionActive.current = active)), []);
  useEffect(() => subscribeWakeListener((state) => (voiceTurnRunning.current = state === 'awake')), []);

  useEffect(() => {
    const collector = createRunEvidenceCollector(({ answer }) => {
      if (!settingsRef.current.playback.autoReadAloud) return;
      // The wake listener speaks its own turns. Reading them again here is the
      // conflict this guard exists to prevent.
      if (sessionActive.current || voiceTurnRunning.current) return;
      if (answer.trim().length === 0) return;

      void speakText({
        text: answer,
        settings: settingsRef.current,
        playback: getSpeechPlayer(),
        maxSpokenCharacters: MAX_SPOKEN_CHARACTERS,
      }).catch((): void => {
        // A reply that cannot be spoken is still on screen; failing loudly over
        // the whole app would be the worse outcome.
      });
    });

    const dispose = ipcBridge.conversation?.responseStream?.on(collector.onStreamMessage);

    return () => {
      dispose?.();
      collector.reset();
      stopSpeech();
    };
  }, []);
};
