/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import { THEME_OVERRIDES_CONFIG_KEY, sanitizeThemeOverrides } from '@/common/config/themeOverrides';
import {
  buildPersonaInstructions,
  REALTIME_PROVIDER_SPECS,
  REALTIME_TOOLS,
  type NormalizedRealtimeEvent,
  type RealtimeCredential,
  type RealtimeProviderId,
  type VoiceConversationProviderId,
} from '@/common/realtime';
import type { FoolVoiceSettings } from '@/common/types/foolVoice';
import { claimManualVoiceSession } from '@renderer/hooks/voice/useFoolVoiceSession';
import { runAgentTask } from '@renderer/services/voice/session/runAgentTask';
import { describeScreen } from '@renderer/services/voice/screenSight';
import {
  publishVoiceActivity,
  publishVoiceReply,
  publishVoiceStage,
  publishVoiceStageOff,
} from '@renderer/services/voice/publishVoiceStage';
import { applyThemeOverrides } from '@renderer/utils/theme/applyThemeOverrides';
import { AdaptiveVad, type VadEvent } from '@renderer/services/voice/AdaptiveVad';
import { RealtimeVoiceClient } from './RealtimeVoiceClient';
import { LocalVoicePipeline, normalizeEndpoint } from './localPipeline';
import { PcmAudioOutput, PcmMicrophone } from './pcmAudio';

/**
 * Everything a spoken conversation does, apart from being drawn.
 *
 * Kept out of the page because the interesting parts are not visual: which
 * provider is paying, when the microphone may open, what happens to the audio
 * already in the speaker when the user starts talking over it, and how any of
 * that reaches the notch on the other side of an IPC boundary.
 */

export type ConversationPhase =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'hearing'
  | 'thinking'
  | 'speaking'
  | 'acting'
  /** Told to wait: still connected and still listening, saying nothing. */
  | 'standby';

export type ConversationActivity = {
  id: string;
  label: string;
  detail: string;
  state: 'running' | 'completed' | 'failed';
};

const TONE_VARIABLES: Record<string, string | null> = {
  blue: '--arcoblue-6',
  violet: '--purple-6',
  teal: '--cyan-6',
  warm: '--orange-6',
  neutral: null,
};

const rgbToHex = (value: string): string | null => {
  const match = value.trim().match(/^(?:rgb\()?\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*\)?$/i);
  if (!match) return null;
  const channels = match.slice(1).map(Number);
  if (channels.some((channel) => channel < 0 || channel > 255)) return null;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
};

const readSemanticColor = (variable: string): string | null =>
  rgbToHex(getComputedStyle(document.documentElement).getPropertyValue(variable));

/**
 * The notch speaks a coarser vocabulary than this page does.
 *
 * It was built for the transcribe-think-speak loop and knows five words. A
 * conversation has no separate transcription step, so `thinking` and `acting`
 * both land on `generating` — which is what the notch draws for "the agent is
 * busy", and is true of both.
 */
const NOTCH_STAGE = {
  idle: 'off',
  connecting: 'processing',
  listening: 'listening',
  hearing: 'hearing',
  thinking: 'generating',
  speaking: 'speaking',
  acting: 'generating',
  // Still listening, because it is: the microphone never closed, and the notch
  // saying otherwise would be telling the user they are not being heard.
  standby: 'listening',
} as const;

/** Level below which the microphone is treated as quiet, for the `hearing` state. */
const SPEECH_LEVEL = 0.06;

/**
 * The rate a local block is played at when it does not name its own.
 *
 * Every block the pipeline emits does name one, so this is only what the
 * speaker is opened with before the first of them arrives.
 */
const LOCAL_OUTPUT_FALLBACK_RATE = 24000;

/**
 * The detector's vocabulary, in the pipeline's.
 *
 * `utterance-truncated` is a turn that ran past the maximum length rather than
 * one that ended in silence, and the pipeline answers it the same way: the
 * alternative is discarding a minute of speech for being too long.
 */
const VAD_TO_PIPELINE: Record<VadEvent, 'speech-started' | 'speech' | 'utterance-ended' | 'idle'> = {
  idle: 'idle',
  calibrating: 'idle',
  'speech-started': 'speech-started',
  speech: 'speech',
  'utterance-ended': 'utterance-ended',
  'utterance-truncated': 'utterance-ended',
};

export const useRealtimeConversation = (settings: FoolVoiceSettings) => {
  const { t, i18n } = useTranslation();

  const [phase, setPhase] = useState<ConversationPhase>('idle');
  const [userTranscript, setUserTranscript] = useState('');
  const [assistantTranscript, setAssistantTranscript] = useState('');
  const [error, setError] = useState('');
  const [providerName, setProviderName] = useState('');
  const [activities, setActivities] = useState<ConversationActivity[]>([]);

  const clientRef = useRef<RealtimeVoiceClient | null>(null);
  /** Set instead of `clientRef` when the conversation is assembled locally. */
  const localRef = useRef<LocalVoicePipeline | null>(null);
  const microphoneRef = useRef<PcmMicrophone | null>(null);
  const outputRef = useRef<PcmAudioOutput | null>(null);
  /** Held for the length of the conversation, so nothing else opens capture. */
  const releaseMicrophoneClaim = useRef<(() => void) | null>(null);
  /** Read inside audio callbacks, which must not re-subscribe on every render. */
  const phaseRef = useRef<ConversationPhase>('idle');
  /** True while waiting: audio still flows, nothing it says is let through. */
  const standbyRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const applyPhase = useCallback((next: ConversationPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  /**
   * Puts the conversation on the notch, the pet and anything else watching.
   *
   * The same publisher the hold-to-talk loop uses, so a spoken conversation and
   * a spoken turn look identical from outside — which is the point: the user
   * does not think of them as two features.
   */
  const publish = useCallback((next: ConversationPhase, extra?: { level?: number; transcript?: string }) => {
    const stage = NOTCH_STAGE[next];
    if (stage === 'off') {
      publishVoiceStageOff();
      return;
    }
    publishVoiceStage({
      stage,
      level: extra?.level ?? 0,
      transcript: extra?.transcript ?? '',
      awake: true,
    });
  }, []);

  const updateActivity = useCallback((id: string, patch: Partial<ConversationActivity>) => {
    setActivities((current) => {
      const existing = current.find((item) => item.id === id);
      const next = !existing
        ? [
            { id, label: patch.label ?? id, detail: patch.detail ?? '', state: patch.state ?? 'running' },
            ...current,
          ].slice(0, 8)
        : current.map((item) => (item.id === id ? { ...item, ...patch } : item));

      // Onto the notch as well, oldest first — it is read top to bottom, and it
      // shows this beside the reply so the user can watch the work and hear the
      // answer at once instead of choosing between them.
      publishVoiceActivity(
        [...next].toReversed().map((item) => ({ text: item.detail || item.label, done: item.state !== 'running' }))
      );
      return next;
    });
  }, []);

  /**
   * Changes the app's accent colour, as the theme tool asks.
   *
   * @throws when the tone is not one the app has a colour for.
   */
  const applyTone = useCallback(
    async (tone: string): Promise<void> => {
      const variable = TONE_VARIABLES[tone];
      if (variable === undefined) throw new Error(t('settings.voice.conversationToneUnknown'));
      const current = sanitizeThemeOverrides(configService.get(THEME_OVERRIDES_CONFIG_KEY));
      const colors = { ...current.colors };
      if (variable === null) {
        delete colors.primary;
      } else {
        const color = readSemanticColor(variable);
        if (!color) throw new Error(t('settings.voice.conversationToneUnknown'));
        colors.primary = color;
      }
      const next = { ...current, colors };
      applyThemeOverrides(next);
      await configService.set(THEME_OVERRIDES_CONFIG_KEY, next);
    },
    [t]
  );

  /**
   * Looks at the screen and hands back what is there, in words.
   *
   * The model doing the looking is a separate setting from the one holding the
   * conversation, defaulting to it: the fast conversational model is often
   * text-only, and a picture sent to one is refused rather than ignored.
   */
  const lookAtScreen = useCallback(async (question: string): Promise<string> => {
    const realtime = settingsRef.current.realtime;
    return describeScreen({
      question,
      endpoint: normalizeEndpoint(realtime.localEndpoint),
      model: realtime.visionModel.trim() || realtime.model.trim(),
      language: realtime.language,
      source: settingsRef.current.session.screenshotSource,
    });
  }, []);

  /**
   * Runs one tool the model called, and answers with the result.
   *
   * Returns the result rather than sending it, because the two providers deliver
   * it differently — a socket session posts it back over the socket, the local
   * pipeline puts it in the next request's messages — and the work of actually
   * doing the thing is identical either way.
   */
  const runToolCall = useCallback(
    async (event: Extract<NormalizedRealtimeEvent, { kind: 'tool-call' }>): Promise<Record<string, unknown>> => {
      applyPhase('acting');
      publish('acting');
      updateActivity(event.callId, {
        label: event.name,
        detail: t('settings.voice.conversationActionRunning'),
        state: 'running',
      });

      const backToListening = (): void => {
        applyPhase('listening');
        publish('listening');
      };

      try {
        const args = JSON.parse(event.argumentsJson || '{}') as Record<string, unknown>;

        if (event.name === 'app_change_theme') {
          const tone = typeof args.tone === 'string' ? args.tone : '';
          await applyTone(tone);
          updateActivity(event.callId, {
            detail: t('settings.voice.conversationThemeChanged', { tone }),
            state: 'completed',
          });
          backToListening();
          return { ok: true };
        }

        if (event.name === 'app_look_at_screen') {
          updateActivity(event.callId, { detail: t('settings.voice.conversationLooking'), state: 'running' });
          const description = await lookAtScreen(typeof args.question === 'string' ? args.question : '');
          updateActivity(event.callId, { detail: description.slice(0, 160), state: 'completed' });
          backToListening();
          // Handed back as the screen's own words rather than a summary of them:
          // the model is about to say this out loud in its own voice, and
          // summarising it here would be a second, worse rewrite.
          return { ok: true, screen: description };
        }

        if (event.name === 'app_ask_jester') {
          const request = typeof args.request === 'string' ? args.request.trim() : '';
          if (request.length === 0) throw new Error(t('settings.voice.conversationActionUnsupported'));
          updateActivity(event.callId, { detail: t('settings.voice.conversationDelegated'), state: 'running' });
          // Back to listening *before* awaiting: the task runs for minutes and
          // the user has to be able to keep talking while it does. This is the
          // whole reason it is not the old navigate-and-prefill.
          backToListening();
          const outcome = await runAgentTask({
            request,
            settings: settingsRef.current,
            onProgress: (detail) => {
              if (detail.length > 0) updateActivity(event.callId, { detail, state: 'running' });
            },
          });
          if (outcome.ok === false) {
            const detail = t(`settings.voice.conversationTaskError.${outcome.reason}`, {
              defaultValue: outcome.detail ?? outcome.reason,
            });
            updateActivity(event.callId, { detail, state: 'failed' });
            return { ok: false, error: detail };
          }
          updateActivity(event.callId, {
            detail: outcome.summary.slice(0, 160) || t('settings.voice.conversationTaskDone'),
            state: 'completed',
          });
          return { ok: true, result: outcome.summary };
        }

        if (event.name === 'app_standby') {
          // Whatever it was part-way through saying is abandoned: being asked to
          // wait means stop now, not stop at the end of this sentence.
          outputRef.current?.flush();
          standbyRef.current = true;
          updateActivity(event.callId, { detail: t('settings.voice.conversationStandbyOn'), state: 'completed' });
          applyPhase('standby');
          publish('standby');
          return { ok: true };
        }

        if (event.name === 'app_resume') {
          standbyRef.current = false;
          updateActivity(event.callId, { detail: t('settings.voice.conversationStandbyOff'), state: 'completed' });
          backToListening();
          return { ok: true };
        }

        throw new Error(t('settings.voice.conversationActionUnsupported'));
      } catch (toolError) {
        const message = toolError instanceof Error ? toolError.message : String(toolError);
        const detail = t(`settings.voice.conversationError.${message}`, { defaultValue: message });
        updateActivity(event.callId, { detail, state: 'failed' });
        backToListening();
        return { ok: false, error: detail };
      }
    },
    [applyPhase, applyTone, lookAtScreen, publish, t, updateActivity]
  );

  /** The socket path: run it, then post the result back over the socket. */
  const runSocketToolCall = useCallback(
    async (event: Extract<NormalizedRealtimeEvent, { kind: 'tool-call' }>): Promise<void> => {
      const result = await runToolCall(event);
      clientRef.current?.sendToolResult(event.callId, event.name, result);
    },
    [runToolCall]
  );

  const handleEvent = useCallback(
    (event: NormalizedRealtimeEvent) => {
      switch (event.kind) {
        case 'ready':
          break;
        case 'user-transcript':
          setUserTranscript((current) => (event.final ? event.text : `${current}${event.text}`));
          // The assistant's last line is cleared only once the user has finished
          // saying something: clearing it on the first partial would blank the
          // screen every time they cleared their throat.
          if (event.final) setAssistantTranscript('');
          publish(phaseRef.current === 'idle' ? 'listening' : phaseRef.current, { transcript: event.text });
          break;
        case 'assistant-transcript': {
          if (standbyRef.current || (event.final && event.text.length === 0)) break;
          setAssistantTranscript((current) => {
            const next = event.final ? event.text : `${current}${event.text}`;
            publishVoiceReply(next);
            return next;
          });
          break;
        }
        case 'audio':
          // Nothing reaches the speaker while waiting. The instruction to stay
          // silent is the model's to follow, and this is what makes it true even
          // when it does not: a stray reply is dropped rather than played into a
          // room where the user asked for quiet.
          if (standbyRef.current) break;
          if (phaseRef.current !== 'acting') {
            applyPhase('speaking');
            publish('speaking');
          }
          void outputRef.current?.enqueue(event.pcm16Base64, event.sampleRate);
          break;
        case 'interrupted':
          // Barge-in. Whatever is queued for the speaker is no longer wanted;
          // the model has already stopped producing it on its own side.
          outputRef.current?.flush();
          break;
        case 'phase':
          if (phaseRef.current === 'acting' || standbyRef.current) break;
          applyPhase(event.phase === 'acting' ? 'acting' : event.phase);
          publish(event.phase === 'acting' ? 'acting' : event.phase);
          break;
        case 'tool-call':
          void runSocketToolCall(event);
          break;
        case 'error':
          setError(t(`settings.voice.conversationError.${event.message}`, { defaultValue: event.message }));
          break;
      }
    },
    [applyPhase, publish, runSocketToolCall, t]
  );

  const stop = useCallback(() => {
    microphoneRef.current?.stop();
    microphoneRef.current = null;
    clientRef.current?.disconnect();
    clientRef.current = null;
    localRef.current?.close();
    localRef.current = null;
    outputRef.current?.close();
    outputRef.current = null;
    releaseMicrophoneClaim.current?.();
    releaseMicrophoneClaim.current = null;
    standbyRef.current = false;
    applyPhase('idle');
    publishVoiceStageOff();
  }, [applyPhase]);

  // Stopped when the page goes away, so a conversation cannot outlive the view
  // of it — an open microphone with nothing on screen is the worst outcome here.
  useEffect(() => stop, [stop]);

  /**
   * The speaker, ready for whichever side is about to talk.
   *
   * `sampleRate` is the rate blocks are assumed to be at when they do not say;
   * a socket provider fixes one for the whole session, and the local pipeline
   * labels every block with the rate its voice model actually rendered at.
   */
  const openOutput = useCallback(
    (sampleRate: number) => {
      const output = new PcmAudioOutput();
      output.configure(sampleRate, settingsRef.current.playback.volume);
      void output.setOutputDevice(settingsRef.current.devices.outputDeviceId);
      output.onDrained = () => {
        if (phaseRef.current === 'speaking') {
          applyPhase('listening');
          publish('listening');
        }
      };
      outputRef.current = output;
    },
    [applyPhase, publish]
  );

  /**
   * Draws the level meter, for as long as the floor is the user's.
   *
   * A meter that moves during the reply is drawing the echo the canceller is
   * already removing, which reads as the assistant interrupting itself.
   */
  const showLevel = useCallback(
    (level: number, speaking: boolean) => {
      if (phaseRef.current !== 'listening' && phaseRef.current !== 'hearing') return;
      const next = speaking ? 'hearing' : 'listening';
      if (next !== phaseRef.current) applyPhase(next);
      publish(next, { level });
    },
    [applyPhase, publish]
  );

  /**
   * A conversation assembled here rather than held with a server.
   *
   * The one structural difference is who notices that the user stopped talking:
   * a hosted provider does it at its end and streams audio continuously, and
   * here the app has to, so the same detector the hold-to-talk loop uses runs
   * over the level meter and hands the pipeline its verdict with every block.
   */
  const startLocal = useCallback(async () => {
    const pipeline = new LocalVoicePipeline({
      settings: settingsRef.current,
      interfaceLanguage: i18n.language,
      onEvent: handleEvent,
      // The same tools the socket providers are given, run by the same code. A
      // local conversation that could not look at the screen or do anything on
      // the computer was the difference the user could feel between the two.
      runTool: (call) =>
        runToolCall({ kind: 'tool-call', callId: call.callId, name: call.name, argumentsJson: call.argumentsJson }),
    });
    await pipeline.connect();
    localRef.current = pipeline;
    setProviderName(t('settings.voice.conversationProviderName.local-pipeline'));

    openOutput(LOCAL_OUTPUT_FALLBACK_RATE);

    const vad = new AdaptiveVad(settingsRef.current.vad);
    // The room, not the last conversation: the device may have changed, and the
    // floor a previous session settled on is not evidence about this one.
    vad.recalibrate();
    let verdict: VadEvent = 'idle';

    const microphone = new PcmMicrophone();
    await microphone.start({
      sampleRate: pipeline.inputSampleRate,
      deviceId: settingsRef.current.devices.inputDeviceId,
      // Called for the same block, immediately before `onAudio`, which is what
      // lets the verdict below be the one for the block being handed over.
      onLevel: (level) => {
        verdict = vad.push(level, performance.now());
        showLevel(level, vad.isSpeaking());
      },
      onAudio: (audio) => pipeline.pushAudio(audio, VAD_TO_PIPELINE[verdict]),
    });
    microphoneRef.current = microphone;
  }, [handleEvent, i18n.language, openOutput, runToolCall, showLevel, t]);

  /** A conversation held with a speech-to-speech server over a socket. */
  const startRemote = useCallback(
    async (providerId: RealtimeProviderId) => {
      const realtime = settingsRef.current.realtime;
      const spec = REALTIME_PROVIDER_SPECS[providerId];
      const model = realtime.model.trim() || spec.defaultModel;

      const response = await ipcBridge.foolVoice.realtimeSession.invoke({
        version: 1,
        requestId: crypto.randomUUID(),
        payload: { providerId, model },
      });
      if (response.ok === false) throw new Error(response.error.code);

      const credential: RealtimeCredential = {
        providerId,
        token: response.data.token,
        endpoint: response.data.endpoint,
        ephemeral: response.data.ephemeral,
      };
      setProviderName(response.data.providerName);

      const client = new RealtimeVoiceClient({
        credential,
        config: {
          model,
          voice: realtime.voice || spec.defaultVoice,
          instructions: buildPersonaInstructions({
            presetId: realtime.personaPresetId,
            customInstructions: realtime.customInstructions,
            language: realtime.language,
            interfaceLanguage: i18n.language,
            // The same phrase the pet answers to, so there is one thing to say
            // to this app rather than one per feature.
            wakePhrase: settingsRef.current.activation.wakePhrase.phrase,
          }),
          language: realtime.language,
          tools: REALTIME_TOOLS,
        },
        onEvent: handleEvent,
      });
      await client.connect();
      clientRef.current = client;

      openOutput(client.outputSampleRate);

      const microphone = new PcmMicrophone();
      await microphone.start({
        sampleRate: client.inputSampleRate,
        deviceId: settingsRef.current.devices.inputDeviceId,
        onAudio: (audio) => client.appendAudio(audio),
        onLevel: (level) => showLevel(level, level > SPEECH_LEVEL),
      });
      microphoneRef.current = microphone;
    },
    [handleEvent, i18n.language, openOutput, showLevel]
  );

  const start = useCallback(async () => {
    setError('');
    setUserTranscript('');
    setAssistantTranscript('');
    setActivities([]);
    standbyRef.current = false;
    applyPhase('connecting');
    publish('connecting');
    // Claimed before the socket rather than after the microphone: the wake-word
    // listener has to have stood down before this conversation opens capture,
    // not while it is already running.
    releaseMicrophoneClaim.current ??= claimManualVoiceSession();

    try {
      const providerId = settingsRef.current.realtime.providerId as VoiceConversationProviderId;
      if (providerId === 'local-pipeline') {
        await startLocal();
      } else {
        await startRemote(providerId);
      }

      applyPhase('listening');
      publish('listening');
    } catch (startError) {
      const code = startError instanceof Error ? startError.message : String(startError);
      stop();
      setError(t(`settings.voice.conversationError.${code}`, { defaultValue: code }));
      applyPhase('idle');
    }
  }, [applyPhase, publish, startLocal, startRemote, stop, t]);

  /** Cuts a reply short by hand, for when the user would rather press a button. */
  const interrupt = useCallback(() => {
    outputRef.current?.flush();
    clientRef.current?.interrupt();
    localRef.current?.interrupt();
    applyPhase('listening');
    publish('listening');
  }, [applyPhase, publish]);

  return {
    phase,
    error,
    setError,
    providerName,
    userTranscript,
    assistantTranscript,
    activities,
    start,
    stop,
    interrupt,
  };
};
