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
} from '@/common/realtime';
import type { FoolVoiceSettings } from '@/common/types/foolVoice';
import { useTalkToJester } from '@renderer/hooks/assistant/useTalkToJester';
import { claimManualVoiceSession } from '@renderer/hooks/voice/useFoolVoiceSession';
import {
  publishVoiceActivity,
  publishVoiceReply,
  publishVoiceStage,
  publishVoiceStageOff,
} from '@renderer/services/voice/publishVoiceStage';
import { applyThemeOverrides } from '@renderer/utils/theme/applyThemeOverrides';
import { RealtimeVoiceClient } from './RealtimeVoiceClient';
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

export const useRealtimeConversation = (settings: FoolVoiceSettings) => {
  const { t, i18n } = useTranslation();
  const talkToJester = useTalkToJester();

  const [phase, setPhase] = useState<ConversationPhase>('idle');
  const [userTranscript, setUserTranscript] = useState('');
  const [assistantTranscript, setAssistantTranscript] = useState('');
  const [error, setError] = useState('');
  const [providerName, setProviderName] = useState('');
  const [activities, setActivities] = useState<ConversationActivity[]>([]);

  const clientRef = useRef<RealtimeVoiceClient | null>(null);
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

  const runToolCall = useCallback(
    async (event: Extract<NormalizedRealtimeEvent, { kind: 'tool-call' }>) => {
      applyPhase('acting');
      publish('acting');
      updateActivity(event.callId, {
        label: event.name,
        detail: t('settings.voice.conversationActionRunning'),
        state: 'running',
      });
      try {
        const args = JSON.parse(event.argumentsJson) as Record<string, unknown>;
        if (event.name === 'app_change_theme') {
          const tone = typeof args.tone === 'string' ? args.tone : '';
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
          updateActivity(event.callId, {
            detail: t('settings.voice.conversationThemeChanged', { tone }),
            state: 'completed',
          });
        } else if (event.name === 'app_ask_jester' && typeof args.request === 'string') {
          updateActivity(event.callId, { detail: t('settings.voice.conversationDelegated'), state: 'completed' });
          await talkToJester({ prompt: args.request });
        } else if (event.name === 'app_standby') {
          // Whatever it was part-way through saying is abandoned: being asked to
          // wait means stop now, not stop at the end of this sentence.
          outputRef.current?.flush();
          standbyRef.current = true;
          updateActivity(event.callId, { detail: t('settings.voice.conversationStandbyOn'), state: 'completed' });
          clientRef.current?.sendToolResult(event.callId, event.name, { ok: true });
          applyPhase('standby');
          publish('standby');
          return;
        } else if (event.name === 'app_resume') {
          standbyRef.current = false;
          updateActivity(event.callId, { detail: t('settings.voice.conversationStandbyOff'), state: 'completed' });
          clientRef.current?.sendToolResult(event.callId, event.name, { ok: true });
          applyPhase('listening');
          publish('listening');
          return;
        } else {
          throw new Error(t('settings.voice.conversationActionUnsupported'));
        }
        clientRef.current?.sendToolResult(event.callId, event.name, { ok: true });
      } catch (toolError) {
        const message = toolError instanceof Error ? toolError.message : String(toolError);
        clientRef.current?.sendToolResult(event.callId, event.name, { ok: false, error: message });
        updateActivity(event.callId, { detail: message, state: 'failed' });
      }
      applyPhase('listening');
      publish('listening');
    },
    [applyPhase, publish, t, talkToJester, updateActivity]
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
          void outputRef.current?.enqueue(event.pcm16Base64);
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
          void runToolCall(event);
          break;
        case 'error':
          setError(t(`settings.voice.conversationError.${event.message}`, { defaultValue: event.message }));
          break;
      }
    },
    [applyPhase, publish, runToolCall, t]
  );

  const stop = useCallback(() => {
    microphoneRef.current?.stop();
    microphoneRef.current = null;
    clientRef.current?.disconnect();
    clientRef.current = null;
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
      const realtime = settingsRef.current.realtime;
      const providerId = realtime.providerId as RealtimeProviderId;
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

      const output = new PcmAudioOutput();
      output.configure(client.outputSampleRate, settingsRef.current.playback.volume);
      void output.setOutputDevice(settingsRef.current.devices.outputDeviceId);
      output.onDrained = () => {
        if (phaseRef.current === 'speaking') {
          applyPhase('listening');
          publish('listening');
        }
      };
      outputRef.current = output;

      const microphone = new PcmMicrophone();
      await microphone.start({
        sampleRate: client.inputSampleRate,
        deviceId: settingsRef.current.devices.inputDeviceId,
        onAudio: (audio) => client.appendAudio(audio),
        onLevel: (level) => {
          // Only while the floor is the user's: a level meter that moves during
          // the reply is drawing the echo the canceller is already removing.
          if (phaseRef.current !== 'listening' && phaseRef.current !== 'hearing') return;
          const next = level > SPEECH_LEVEL ? 'hearing' : 'listening';
          if (next !== phaseRef.current) applyPhase(next);
          publish(next, { level });
        },
      });
      microphoneRef.current = microphone;

      applyPhase('listening');
      publish('listening');
    } catch (startError) {
      const code = startError instanceof Error ? startError.message : String(startError);
      stop();
      setError(t(`settings.voice.conversationError.${code}`, { defaultValue: code }));
      applyPhase('idle');
    }
  }, [applyPhase, handleEvent, i18n.language, publish, stop, t]);

  /** Cuts a reply short by hand, for when the user would rather press a button. */
  const interrupt = useCallback(() => {
    outputRef.current?.flush();
    clientRef.current?.interrupt();
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
