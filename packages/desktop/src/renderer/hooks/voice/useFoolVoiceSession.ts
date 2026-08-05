/**
 * @license
 * Copyright 2026 The Fool contributors
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
import { getSpeechPlayer } from '@renderer/services/voice/speechPlayer';
import { MicrophoneCapture } from '@renderer/services/voice/MicrophoneCapture';
import { EMPTY_EVIDENCE, describeEvidence, type RunEvidence } from '@renderer/services/voice/narration/FoolNarrator';
import { truncateToSpokenLength } from '@renderer/services/voice/narration/narrationSanitizer';
import { createRunEvidenceCollector } from '@renderer/services/voice/RunEvidenceCollector';
import { applyTranscriptRules } from '@/common/voice/transcriptRules';
import { createIncrementalSpeechCollector } from '@renderer/services/voice/IncrementalSpeechCollector';
import { createSpeechClipQueue, type SpeechClipQueue } from '@renderer/services/voice/speechClipQueue';
import { prepareSynthesis, speakText } from '@renderer/services/voice/speakText';
import { publishVoiceStage, publishVoiceStageOff } from '@renderer/services/voice/publishVoiceStage';
import {
  VOICE_REPLY_EVENT,
  VOICE_TURN_EVENT,
  type VoiceReplyDetail,
  type VoiceSubmitDetail,
} from '@renderer/services/voice/voiceEvents';
import { findWakePhrase } from '@renderer/services/voice/wakePhrase';

// The event names live in a module with no dependencies, so a composer can listen
// for them without importing the voice session, the IPC bridge and the i18n
// runtime along the way.
export {
  VOICE_HOME_SUBMIT_EVENT,
  VOICE_REPLY_EVENT,
  VOICE_SUBMIT_EVENT,
  VOICE_TURN_EVENT,
  type VoiceReplyDetail,
  type VoiceSubmitDetail,
} from '@renderer/services/voice/voiceEvents';

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
  /**
   * Takes a turn without the wake phrase, opening the microphone if it is shut.
   *
   * This is what the global shortcut calls. Pressed again while the turn is still
   * being spoken it ends the utterance and sends it, so a quiet room does not
   * leave the turn waiting on silence that has already arrived.
   */
  awakenNow: () => Promise<void>;
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

/**
 * How long a turn may run before the listener stops waiting for its answer.
 *
 * Only a backstop for a run that never reports back at all. A real answer
 * releases the hold the moment it starts being spoken, so this number does not
 * cap how long an agent may work — it caps how long a broken turn can leave the
 * microphone deaf.
 */
const MAX_AGENT_WAIT_MS = 10 * 60 * 1000;

/**
 * How long the answer is protected from being interrupted by itself.
 *
 * Speech leaves the speakers and comes straight back in through the microphone.
 * Echo cancellation removes most of it, not all — and the detector only needs
 * one frame over the bar to call it speech and cut the answer off. That is what
 * left every reply lasting half a second: the voice interrupting itself.
 *
 * Long enough to cover the leak at the start of playback, short enough that
 * talking over the answer still works — which is the point of barge-in.
 */
const BARGE_IN_GUARD_MS = 1200;

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

/**
 * Takes the microphone for something that is not this session's turn loop.
 *
 * The speech-to-speech conversation holds its own capture for as long as it
 * runs. Without this the wake-word listener keeps its microphone open alongside
 * it: two recorders on one device, and — far worse — a pet that hears the
 * assistant's reply come out of the speakers, matches the wake phrase in it, and
 * starts a second conversation about the first one.
 *
 * Returns the release, so the caller cannot forget which flag it set.
 */
export const claimManualVoiceSession = (): (() => void) => {
  setManualSessionActive(true);
  return () => setManualSessionActive(false);
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
  const vad = useRef<AdaptiveVad | null>(null);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  /** True while this session is only waiting for the wake phrase. */
  const wakeModeRef = useRef(false);
  /** When the wake phrase's follow-up window closes. */
  const awakeUntilRef = useRef(0);
  const utteranceStartedAtRef = useRef(0);
  /**
   * True while the agent is working and audio is being ignored.
   *
   * The microphone stays open — reopening it costs a device round-trip and, on
   * some machines, a permission blink — but nothing is listened to. Otherwise
   * everything said or overheard during a two-minute run queues up as the next
   * command.
   */
  const holdRef = useRef(false);
  /** Releases the hold if the answer never arrives. */
  const holdTimer = useRef<number | null>(null);
  /**
   * True when the shortcut opened the microphone with nothing else listening.
   *
   * Such a session belongs to that one turn: it closes when the answer has been
   * spoken rather than staying open over a desktop nobody asked to be heard on.
   */
  const oneShotRef = useRef(false);
  /** Set below, so the speaking path can close a one-shot session. */
  const stopRef = useRef<() => void>(() => undefined);
  /** When the answer started playing, so it cannot interrupt itself. */
  const playbackStartedAtRef = useRef(0);
  /** Outlives re-subscription, so a turn's text is never thrown away mid-run. */
  const collectorRef = useRef<ReturnType<typeof createRunEvidenceCollector> | null>(null);
  /**
   * True only between sending a spoken turn and speaking its answer.
   *
   * The session listens to the whole conversation stream, so without this it
   * also spoke replies to turns the user *typed* — at the same time as the
   * read-aloud setting was speaking them, two clips over each other from two
   * playback services. The rattle that cut off after half a second was the two
   * colliding, which is why the read-aloud button alone always sounded right.
   */
  const expectingAnswerRef = useRef(false);

  /**
   * The streaming-speech path — used instead of `collectorRef`'s when
   * `settings.summary.translateToEnglish` is off, so the reply is spoken as
   * it arrives instead of waiting to be translated and shortened first.
   *
   * Two collectors run over the same messages: `incrementalCollectorRef`
   * speaks sentences as they complete, and `evidenceCollectorRef` — a plain
   * `RunEvidenceCollector`, reused rather than duplicated for its evidence
   * tracking — reports the run's evidence once the turn finishes, which is
   * also this path's single "the turn is done" signal (its own text half is
   * ignored; the sentences already went out through the collector above).
   */
  const incrementalCollectorRef = useRef<ReturnType<typeof createIncrementalSpeechCollector> | null>(null);
  const evidenceCollectorRef = useRef<ReturnType<typeof createRunEvidenceCollector> | null>(null);
  /** The queue built for whichever turn is currently streaming in on that path. */
  const incrementalQueueRef = useRef<SpeechClipQueue | null>(null);
  /** Dedupes concurrent `ensureIncrementalQueueReady` calls from sentences arriving before the first one resolves. */
  const incrementalPreparingRef = useRef<Promise<void> | null>(null);
  /** True once a turn has been claimed as ours to speak, mirroring `expectingAnswerRef`'s consumption in `speakThenListen`. */
  const incrementalTurnClaimedRef = useRef(false);
  /** Rebuilt every render so the collectors above — built once — always call the current version. */
  const ensureIncrementalQueueReadyRef = useRef<(sampleText: string) => Promise<void>>(() => Promise.resolve());
  const finishIncrementalTurnRef = useRef<(evidence: RunEvidence) => void>(() => undefined);

  const sessionId = useMemo(() => crypto.randomUUID(), []);

  const enter = useCallback((next: VoiceTurnStateInput) => {
    setState({ ...next, enteredAtMs: Date.now() } as VoiceTurnState);
  }, []);

  /** Stops ignoring audio and clears the safety timer. */
  const release = useCallback(() => {
    holdRef.current = false;
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const listen = useCallback(() => {
    release();
    vad.current?.reset();
    capture.current?.beginUtterance();
    utteranceStartedAtRef.current = Date.now();
    publishVoiceStage({ stage: 'listening', phrase: settings.activation.wakePhrase.phrase, awake: true });
    enter({
      phase: 'command-listening',
      sessionId,
      clientTurnId: crypto.randomUUID(),
      condition: { status: 'normal' },
    });
  }, [enter, release, sessionId, settings.activation.wakePhrase.phrase]);

  /** Back to waiting for the phrase, with the microphone still open. */
  const listenForWake = useCallback(() => {
    release();
    vad.current?.reset();
    capture.current?.beginUtterance();
    utteranceStartedAtRef.current = Date.now();
    publishVoiceStage({ stage: 'listening', phrase: settings.activation.wakePhrase.phrase, awake: false });
    enter({ phase: 'wake-listening', sessionId, condition: { status: 'normal' } });
  }, [enter, release, sessionId, settings.activation.wakePhrase.phrase]);

  const isAwake = useCallback(() => Date.now() < awakeUntilRef.current, []);

  /**
   * Stops listening until the answer starts being spoken.
   *
   * The safety timer is the important half: if the turn never reports back — a
   * crashed agent, a stream that ends without a final message — the listener must
   * not sit deaf forever. It drops back to whichever mode it was in, which for a
   * wake-word session means waiting for the phrase again.
   */
  const hold = useCallback(() => {
    holdRef.current = true;
    // This turn came from the microphone, so its answer is this session's to
    // speak. Anything else arriving on the stream is not.
    expectingAnswerRef.current = true;
    capture.current?.takeUtteranceWav();
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      if (!activeRef.current) return;
      // The answer never came. Give up the claim on it too, or the next typed
      // turn's reply would be spoken as though it had been asked for aloud.
      expectingAnswerRef.current = false;
      if (wakeModeRef.current) listenForWake();
      else listen();
    }, MAX_AGENT_WAIT_MS);
  }, [listen, listenForWake]);

  const submit = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent<VoiceSubmitDetail>(VOICE_TURN_EVENT, { detail: { text } }));
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

      const text = transcription.text.trim();
      // The wake check sees the raw transcript: it is matching a fixed phrase
      // against what was actually said, and a rule that removed a hesitation
      // inside the phrase would stop the app answering to its own name.
      return purpose === 'wake' ? text : applyTranscriptRules(text, settings.transcript);
    },
    [enter, sessionId, settings.stt, settings.transcript]
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
        // A short chime is the fastest possible "yes, I heard you" — it lands
        // before any window has repainted.
        void getSpeechPlayer()
          .playWakeChime()
          .catch((): void => undefined);
        publishVoiceStage({
          stage: 'processing',
          transcript: heard,
          phrase: settings.activation.wakePhrase.phrase,
          awake: true,
        });
        enter({
          phase: 'wake-detected',
          sessionId,
          matchedPhrase: settings.activation.wakePhrase.phrase,
          condition: { status: 'normal' },
        });

        // "wake up fool, run the tests" should not need saying twice.
        if (match.commandText.length > 0) {
          submit(match.commandText);
          hold();
          return;
        }
        listen();
        return;
      }

      publishVoiceStage({ stage: 'processing', phrase: settings.activation.wakePhrase.phrase, awake: true });
      const text = await transcribe(audio, 'command');
      if (text.length === 0) {
        if (wakeModeRef.current && !isAwake()) listenForWake();
        else listen();
        return;
      }

      // Each exchange extends the window, so a conversation does not need the
      // phrase again between turns.
      if (wakeModeRef.current) awakeUntilRef.current = Date.now() + AWAKE_WINDOW_MS;

      publishVoiceStage({
        stage: 'generating',
        transcript: text,
        phrase: settings.activation.wakePhrase.phrase,
        awake: true,
      });
      submit(text);
      // Nothing is listened to until the answer starts being spoken. A long run
      // otherwise turns every overheard sentence into the next command.
      hold();
    },
    [enter, hold, isAwake, listen, listenForWake, sessionId, settings.activation.wakePhrase.phrase, submit, transcribe]
  );

  /**
   * Closes the current utterance and runs it, wherever the decision came from.
   *
   * Two callers: the detector deciding the speaker has stopped, and the global
   * shortcut being pressed a second time to say the same thing deliberately.
   */
  const processUtterance = useCallback(() => {
    if (!activeRef.current || !capture.current) return;
    if (busyRef.current || holdRef.current) return;

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
  }, [enter, handleUtterance, isAwake, sessionId]);

  const onFrame = useCallback(
    ({ rms }: { rms: number }) => {
      if (!activeRef.current || !vad.current || !capture.current) return;
      // The agent is working. The microphone is open but nothing said to it counts
      // until there is an answer to interrupt.
      if (holdRef.current) return;

      const event = vad.current.push(rms, performance.now());

      // Barge-in belongs to hands-free turns only — the wake word and the
      // desktop shortcut, where talking over the answer is the only way to stop
      // it. In a chat the user has a screen and a button, and cutting the reply
      // off because the microphone overheard something is never what they meant.
      //
      // Even there it waits out the opening moment: speech leaves the speakers
      // and comes back in through the microphone, echo cancellation removes most
      // of it but not all, and one frame over the bar is enough to call it
      // speech. That is what left every reply lasting half a second — the voice
      // interrupting itself.
      const handsFree = wakeModeRef.current || oneShotRef.current;
      const settling = Date.now() - playbackStartedAtRef.current < BARGE_IN_GUARD_MS;
      if (event === 'speech-started' && handsFree && !settling) getSpeechPlayer().stop();

      // While speech is arriving, the caption strip draws this level as the
      // waveform: what is on screen is the sound in the room.
      if (event === 'speech-started' || vad.current.isSpeaking()) {
        publishVoiceStage({
          stage: 'hearing',
          level: rms * 4,
          phrase: settings.activation.wakePhrase.phrase,
          awake: !wakeModeRef.current || isAwake(),
        });
      }

      if (event !== 'utterance-ended' && event !== 'utterance-truncated') return;
      processUtterance();
    },
    [isAwake, processUtterance, settings.activation.wakePhrase.phrase]
  );

  /**
   * There is now something to interrupt, so start listening again — this is
   * the moment the hold taken at submit time is for. Reset the detector
   * first: it has heard nothing for however long the run took, and its idea
   * of the noise floor is stale.
   *
   * Shared by both speaking paths (`speak`'s single passage and the
   * incremental queue below) — each renders the answer as a run of clips, and
   * this is what "the first one is about to play" means for either.
   */
  const onSpeechPlaybackStart = useCallback((): void => {
    release();
    vad.current?.reset();
    capture.current?.beginUtterance();
    utteranceStartedAtRef.current = Date.now();
  }, [release]);

  /**
   * Every clip, not just the first: the guard it feeds exists so the voice's
   * own echo cannot be heard as the user interrupting, and each clip leaks
   * its own opening moment into the microphone.
   */
  const onSpeechClipStart = useCallback((): void => {
    playbackStartedAtRef.current = Date.now();
  }, []);

  const speak = useCallback(
    async (answer: string, evidence: RunEvidence): Promise<void> => {
      // Translated and shortened first when that is switched on, so the voice
      // reads a briefing in the language it can actually pronounce rather than a
      // full reply in one it cannot.
      // What the model wrote, and nothing else. This used to run through the
      // narrator, which appended sentences about the run — and, when it was
      // handed nothing, replaced the whole reply with its fallback word:
      // "Done." Speech is now the model's own text, sanitised so code and
      // secrets can never be read out, and stopping there.
      const operationId = newOperationId();
      publishVoiceStage({ stage: 'speaking', phrase: settings.activation.wakePhrase.phrase, awake: true });
      enter({
        phase: 'speaking',
        sessionId,
        conversationId: sessionId,
        turnId: operationId,
        operationId,
        condition: { status: 'normal' },
      });

      // The same routine the read-aloud button goes through, which is the point:
      // this used to be a second copy of it, and the two drifted on which voice
      // to pick and on what to do when the chosen one was gone. It also renders
      // the answer as a run of clips, so a long reply starts being spoken after
      // its first sentence rather than after all of them.
      await speakText({
        text: answer,
        settings,
        playback: getSpeechPlayer(),
        maxSpokenCharacters: settings.narrator.maxSpokenCharacters,
        // The summary can take a model load, and the session may be closed
        // during it; speaking then would talk over a shut microphone.
        shouldContinue: () => activeRef.current,
        onPlaybackStart: onSpeechPlaybackStart,
        onClipStart: onSpeechClipStart,
      });
      playbackStartedAtRef.current = 0;
    },
    [enter, onSpeechClipStart, onSpeechPlaybackStart, sessionId, settings]
  );

  /**
   * What happens once an answer is done being spoken — success or failure,
   * the microphone must not stay deaf because a synthesis call failed.
   *
   * Shared by both speaking paths, so a one-shot session closes and a wake
   * session drops back to listening for the phrase the same way regardless
   * of which one spoke the answer.
   */
  const resumeAfterSpeaking = useCallback((): void => {
    if (!activeRef.current) return;
    // A microphone the shortcut opened is the shortcut's to close: nothing
    // else was listening before it, and nothing should be after.
    if (oneShotRef.current) {
      stopRef.current();
      return;
    }
    // An always-on listener whose follow-up window has closed goes back to
    // waiting for the phrase rather than treating the room as input.
    if (wakeModeRef.current && !isAwake()) listenForWake();
    else listen();
  }, [isAwake, listen, listenForWake]);

  const speakThenListen = useCallback(
    (answer: string, evidence: RunEvidence): void => {
      if (!activeRef.current) return;
      // Not this session's turn to speak: a typed one, answered while the wake
      // listener happened to be holding the microphone open.
      if (!expectingAnswerRef.current) return;
      expectingAnswerRef.current = false;

      void speak(answer, evidence)
        .catch((): void => {
          // A synthesis failure must not end the session; keep listening.
        })
        .finally(resumeAfterSpeaking);
    },
    [resumeAfterSpeaking, speak]
  );

  // The collector is built once and calls whichever version is current.
  const speakThenListenRef = useRef(speakThenListen);
  speakThenListenRef.current = speakThenListen;

  /**
   * Builds this turn's queue if nothing has yet — idempotent, and safe to
   * call more than once for the same turn (from a sentence, and again from
   * the evidence tail below): `incrementalQueueRef`/`incrementalPreparingRef`
   * gate every call after the first.
   *
   * Does not itself decide whether this turn is ours to speak — both callers
   * below establish that first.
   */
  const ensureIncrementalQueueBuilt = useCallback(
    (sampleText: string): Promise<void> => {
      if (incrementalQueueRef.current) return Promise.resolve();
      if (incrementalPreparingRef.current) return incrementalPreparingRef.current;

      incrementalPreparingRef.current = (async (): Promise<void> => {
        try {
          const prepared = await prepareSynthesis(sampleText, settings, getSpeechPlayer());
          if ('unavailable' in prepared || !activeRef.current) return;
          incrementalQueueRef.current ??= createSpeechClipQueue(getSpeechPlayer(), prepared.synthesize, {
            shouldContinue: () => activeRef.current,
            onPlaybackStart: onSpeechPlaybackStart,
            onClipStart: onSpeechClipStart,
          });
        } catch {
          // No voice to prepare with; `finishIncrementalTurn` still resumes
          // listening once the turn's evidence arrives, same as a failed
          // `speakText` call does not leave the microphone deaf on the other path.
        }
      })();
      return incrementalPreparingRef.current;
    },
    [onSpeechClipStart, onSpeechPlaybackStart, settings]
  );

  /**
   * Starts (once) the queue this turn's sentences are pushed into, and
   * claims the turn — consuming `expectingAnswerRef`, same as
   * `speakThenListen` does for the other path — the moment it decides this
   * one is ours, not once speech actually starts.
   *
   * Mirrors `useAutoReadAloud`'s `ensureQueueReady`.
   */
  const ensureIncrementalQueueReady = useCallback(
    (sampleText: string): Promise<void> => {
      if (incrementalQueueRef.current || incrementalPreparingRef.current) {
        return ensureIncrementalQueueBuilt(sampleText);
      }
      if (!activeRef.current || !expectingAnswerRef.current) return Promise.resolve();
      expectingAnswerRef.current = false;
      incrementalTurnClaimedRef.current = true;
      return ensureIncrementalQueueBuilt(sampleText);
    },
    [ensureIncrementalQueueBuilt]
  );

  /**
   * Appends the run's evidence tail and, once every clip has played, resumes
   * listening — this path's single "the turn is done" step, driven by the
   * evidence collector's own completion below rather than the incremental
   * text collector's, which has nothing left to say once its sentences are
   * queued.
   */
  const finishIncrementalTurn = useCallback(
    (evidence: RunEvidence): void => {
      const alreadyClaimed = incrementalTurnClaimedRef.current;
      incrementalTurnClaimedRef.current = false;

      // A sentence already claimed this turn, or nothing ever did — a run
      // that ended with no speakable text before it (tool calls only, say)
      // means `ensureIncrementalQueueReady` never ran. Claim it here instead,
      // so the microphone is not left held until the 10-minute safety timer;
      // a turn nobody claimed either way is a typed one finishing, not ours.
      if (!alreadyClaimed) {
        if (!activeRef.current || !expectingAnswerRef.current) return;
        expectingAnswerRef.current = false;
      }

      const tail = truncateToSpokenLength(
        describeEvidence(evidence, settings.narrator.language),
        settings.narrator.maxSpokenCharacters
      );

      void (async (): Promise<void> => {
        if (tail.length > 0) {
          // Nothing may have built the queue yet (the "no speakable text"
          // case above) — this is also where that happens, with the tail
          // itself as the sample the voice is picked from.
          await ensureIncrementalQueueBuilt(tail);
          incrementalQueueRef.current?.push(tail);
        }
        const queue = incrementalQueueRef.current;
        incrementalQueueRef.current = null;
        incrementalPreparingRef.current = null;
        await (queue?.finish() ?? Promise.resolve()).catch((): void => undefined);
        resumeAfterSpeaking();
      })();
    },
    [
      ensureIncrementalQueueBuilt,
      resumeAfterSpeaking,
      settings.narrator.language,
      settings.narrator.maxSpokenCharacters,
    ]
  );

  // The collectors built inside the effect below are built once and kept, for
  // the same reason `collectorRef`'s is — calling through these refs is what
  // keeps them using the current settings and callbacks regardless.
  ensureIncrementalQueueReadyRef.current = ensureIncrementalQueueReady;
  finishIncrementalTurnRef.current = finishIncrementalTurn;

  // Turn completion arrives on the conversation's existing response stream.
  // Subscribing here — rather than adding a second detection path — keeps the
  // spoken brief in step with what the screen already shows.
  useEffect(() => {
    if (settings.summary.translateToEnglish) {
      // Built once and kept. `speakThenListen` is rebuilt whenever the settings
      // object changes identity, and re-running this effect used to throw the
      // collector away mid-turn — taking the text it had gathered with it. The
      // reply then arrived with nothing in it, and the narrator, left with neither
      // an answer nor evidence, fell back to its one-word phrase: "Done."
      collectorRef.current ??= createRunEvidenceCollector(({ answer, evidence }) =>
        speakThenListenRef.current(answer, evidence)
      );
      const collector = collectorRef.current;
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
        // Deliberately not reset: this cleanup also runs on a plain re-subscribe,
        // and clearing here is what lost the turn's text in the first place. The
        // collector clears itself when a turn completes, and `stop` clears it when
        // the session really ends.
        window.removeEventListener(VOICE_REPLY_EVENT, handleReply);
      };
    }

    // The English summary is off: speak the reply as it streams in instead of
    // waiting for the whole thing, then a short evidence tail once the run it
    // reports on — not just the reply's prose — has actually finished.
    //
    // Two collectors run over the same messages, for the same "built once and
    // kept" reason as `collectorRef`'s: `incrementalCollectorRef` speaks
    // sentences as they complete; `evidenceCollectorRef` — a plain
    // `RunEvidenceCollector`, reused for its evidence tracking rather than
    // duplicating it — reports the run's evidence at `finish`, which is also
    // this path's "the turn is done" signal (its own answer text is ignored;
    // the sentences already went out through the collector above).
    incrementalCollectorRef.current ??= createIncrementalSpeechCollector(
      (sentence) => {
        void ensureIncrementalQueueReadyRef.current(sentence).then(() => {
          incrementalQueueRef.current?.push(sentence);
        });
      },
      () => undefined,
      settings.narrator.maxSpokenCharacters
    );
    evidenceCollectorRef.current ??= createRunEvidenceCollector(({ evidence }) =>
      finishIncrementalTurnRef.current(evidence)
    );
    const incrementalCollector = incrementalCollectorRef.current;
    const evidenceCollector = evidenceCollectorRef.current;
    const disposeStream = ipcBridge.conversation?.responseStream?.on((message) => {
      incrementalCollector.onStreamMessage(message);
      evidenceCollector.onStreamMessage(message);
    });

    return () => {
      disposeStream?.();
    };
  }, [speakThenListen, settings]);

  const stop = useCallback(() => {
    const wasManual = activeRef.current && !wakeModeRef.current;
    activeRef.current = false;
    busyRef.current = false;
    expectingAnswerRef.current = false;
    collectorRef.current?.reset();
    incrementalCollectorRef.current?.reset();
    evidenceCollectorRef.current?.reset();
    incrementalQueueRef.current = null;
    incrementalPreparingRef.current = null;
    incrementalTurnClaimedRef.current = false;
    wakeModeRef.current = false;
    awakeUntilRef.current = 0;
    oneShotRef.current = false;
    release();
    getSpeechPlayer().stop();
    capture.current?.stop();
    capture.current = null;
    vad.current = null;
    if (wasManual) setManualSessionActive(false);
    // No surface should be left claiming to listen after the microphone closes.
    publishVoiceStageOff();
    setState(idleState());
  }, [release]);

  // `speakThenListen` is defined above `stop` and has to be able to call it; a ref
  // keeps that one direction of the cycle from becoming a dependency loop.
  stopRef.current = stop;

  /**
   * Checks the models, then opens capture and playback.
   *
   * Returns false when a required model is missing, so neither entry point starts
   * on a promise it cannot keep. Speech output is only required for a session
   * that will talk back — the wake listener just needs to hear.
   */
  const openMicrophone = useCallback(
    async (options: { requireSpeechOutput: boolean }): Promise<boolean> => {
      // Transcription is sherpa's alone; the voice that speaks belongs to
      // whichever provider the picker recorded when it was chosen. Asking
      // sherpa about an audio.cpp voice gets "unavailable", which reads here as
      // a missing model and refuses to open the microphone at all.
      const required: { modelId: string; providerId: 'local-sherpa' | 'local-audiocpp' }[] = [
        { modelId: settings.stt.modelId, providerId: 'local-sherpa' },
      ];
      if (options.requireSpeechOutput) {
        required.push({
          modelId: settings.tts.modelId,
          providerId: settings.tts.providerId === 'local-audiocpp' ? 'local-audiocpp' : 'local-sherpa',
        });
      }

      for (const { modelId, providerId } of required) {
        const health = unwrap(
          await ipcBridge.foolVoice.health.invoke({
            version: 1,
            requestId: newOperationId(),
            payload: { providerId, modelId },
          })
        );
        if (health.status !== 'ready') {
          setMissingModelId(modelId);
          return false;
        }
      }
      setMissingModelId(null);

      // The catalog used to be read here to decide which voice to speak with.
      // `speakText` reads it when it is about to speak instead, which is both
      // one fewer round-trip on the way to an open microphone and an answer that
      // cannot be stale by the time it is used.
      capture.current = new MicrophoneCapture();
      getSpeechPlayer().setOutputDevice(settings.devices.outputDeviceId);
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
    oneShotRef.current = false;
    // Started by hand, so no phrase is needed before the first sentence.
    awakeUntilRef.current = Date.now() + AWAKE_WINDOW_MS;
    setManualSessionActive(true);
    listen();
  }, [listen, openMicrophone, stop]);

  const awakenNow = useCallback(async () => {
    // Pressed again during the same turn: the user has said what they meant to
    // say and would rather not wait for the detector to agree.
    if (activeRef.current && isAwake() && !holdRef.current && !busyRef.current) {
      processUtterance();
      return;
    }

    if (!activeRef.current) {
      // Nothing was listening — the pet is off, or the app is minimised with no
      // session. Open the microphone for this one turn.
      if (!(await openMicrophone({ requireSpeechOutput: true }))) return;
      wakeModeRef.current = false;
      oneShotRef.current = true;
    }

    awakeUntilRef.current = Date.now() + AWAKE_WINDOW_MS;
    // The same chime the wake phrase gives: the fastest possible "I am listening",
    // and the only feedback there is when the window is not on screen.
    void getSpeechPlayer()
      .playWakeChime()
      .catch((): void => undefined);
    listen();
  }, [isAwake, listen, openMicrophone, processUtterance]);

  const startWakeListening = useCallback(async () => {
    // Already listening, or the user is deliberately talking: leave the
    // microphone where it is.
    if (activeRef.current || manualSessionActive) return;

    if (!(await openMicrophone({ requireSpeechOutput: false }))) return;

    wakeModeRef.current = true;
    oneShotRef.current = false;
    awakeUntilRef.current = 0;
    listenForWake();
  }, [listenForWake, openMicrophone]);

  useEffect(() => stop, [stop]);

  return { state, missingModelId, isActive: activeRef.current, start, startWakeListening, awakenNow, stop };
};
