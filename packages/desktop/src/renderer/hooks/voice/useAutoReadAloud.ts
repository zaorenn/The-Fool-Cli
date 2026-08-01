/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { ipcBridge } from '@/common';
import { getSpeechPlayer, stopSpeech } from '@renderer/services/voice/speechPlayer';
import { createIncrementalSpeechCollector } from '@renderer/services/voice/IncrementalSpeechCollector';
import { createSpeechClipQueue, type SpeechClipQueue } from '@renderer/services/voice/speechClipQueue';
import { prepareSynthesis } from '@renderer/services/voice/speakText';
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
 * Speech starts on the first complete sentence rather than waiting for the
 * reply to finish — the same reasoning `speakText` already applies within one
 * passage (rendering clip *n+1* while clip *n* plays), stretched over the
 * whole streamed reply so the first clip can start rendering the moment there
 * is a sentence to render, not once the model has stopped talking.
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
    // Everything below lives for the duration of this effect, not per turn:
    // `onDone` resets `queue`/`preparing` so the next turn starts over.
    let queue: SpeechClipQueue | null = null;
    /** Dedupes concurrent `ensureQueueReady` calls from sentences arriving before the first one resolves. */
    let preparing: Promise<void> | null = null;

    // Re-checked on every clip by the queue itself (`shouldContinue`), and
    // once up front before spending a catalog round-trip on a turn nobody
    // will hear: the wake listener speaks its own turns, and reading them
    // again here is the conflict this guard exists to prevent.
    const guard = (): boolean =>
      settingsRef.current.playback.autoReadAloud && !sessionActive.current && !voiceTurnRunning.current;

    const ensureQueueReady = (sampleText: string): Promise<void> => {
      if (queue) return Promise.resolve();
      if (!guard()) return Promise.resolve();

      preparing ??= (async (): Promise<void> => {
        const prepared = await prepareSynthesis(sampleText, settingsRef.current, getSpeechPlayer());
        if ('unavailable' in prepared) return;
        // Settings, or the session, may have changed while the catalog loaded.
        if (!guard()) return;
        queue ??= createSpeechClipQueue(getSpeechPlayer(), prepared.synthesize, { shouldContinue: guard });
      })();
      return preparing;
    };

    const collector = createIncrementalSpeechCollector(
      (sentence) => {
        void ensureQueueReady(sentence).then(() => {
          queue?.push(sentence);
        });
      },
      () => {
        void queue?.finish();
        queue = null;
        preparing = null;
      },
      MAX_SPOKEN_CHARACTERS
    );

    const dispose = ipcBridge.conversation?.responseStream?.on(collector.onStreamMessage);

    return () => {
      dispose?.();
      collector.reset();
      queue = null;
      preparing = null;
      stopSpeech();
    };
  }, []);
};
