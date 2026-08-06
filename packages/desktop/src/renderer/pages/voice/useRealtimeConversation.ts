/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import {
  isValidHexColor,
  MAX_THEME_PALETTES,
  normalizePaletteName,
  sanitizeThemeOverrides,
  sanitizeThemePalettes,
  THEME_OVERRIDES_CONFIG_KEY,
  THEME_PALETTES_CONFIG_KEY,
  type ThemeColorKey,
  type ThemeOverrides,
} from '@/common/config/themeOverrides';
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
import { parseOpenUrls } from '@/common/realtime/openUrls';
import { createHoldGate } from '@/common/voice/holdToTalkGate';
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

/**
 * What the spoken word for a colour's job maps to in the theme.
 *
 * "Accent" rather than "primary" in the tool, because that is what a person
 * calls it — the stored key keeps the name the rest of the app uses.
 */
const THEME_TARGETS: Record<string, ThemeColorKey> = {
  accent: 'primary',
  background: 'background',
  surface: 'surface',
  text: 'text',
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

/**
 * How long a task may run silently before the voice says it is still working.
 *
 * Long enough that a quick job simply finishes — an assistant announcing work it
 * has already done is worse than one that says nothing — and short enough that
 * the silence never reads as a crash.
 */
const HEARTBEAT_FIRST_MS = 12_000;

/** And how often after that. Sparse: this is reassurance, not narration. */
const HEARTBEAT_EVERY_MS = 25_000;

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
  /**
   * Whether right Ctrl is down right now, when hold-to-talk is switched on.
   *
   * A ref rather than state: it is read inside the microphone's audio callback,
   * which is subscribed once for the whole conversation and must not be torn
   * down and rebuilt every time a key moves.
   */
  const holdingRef = useRef(false);
  /**
   * The microphone's current level, for whatever is drawing it.
   *
   * A ref rather than state: this changes many times a second, and putting it
   * through React would re-render the whole page for every audio block. The
   * meter reads it inside its own animation frame instead.
   */
  const levelRef = useRef(0);
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
  /**
   * Changes, keeps or recalls the app's colours, as asked out loud.
   *
   * The colour itself comes from the model rather than from a table here.
   * "Warmer", "like the sea", "the green of an old terminal" are language
   * problems, and a fixed list of five tones answered all of them with the same
   * five colours — the setting existed, the request did not survive it.
   *
   * Everything written is validated before it reaches a CSS variable: a hex
   * value from a model is untrusted input like any other.
   */
  const applyThemeAction = useCallback(
    async (action: string, target: string, color: string, name: string): Promise<string> => {
      const stored = sanitizeThemeOverrides(configService.get(THEME_OVERRIDES_CONFIG_KEY));
      const palettes = sanitizeThemePalettes(configService.get(THEME_PALETTES_CONFIG_KEY));
      const key = THEME_TARGETS[target] ?? 'primary';

      const commit = async (colors: ThemeOverrides['colors']): Promise<void> => {
        const next = { colors };
        applyThemeOverrides(next);
        await configService.set(THEME_OVERRIDES_CONFIG_KEY, next);
      };

      if (action === 'reset') {
        await commit({});
        return t('settings.voice.conversationThemeReset');
      }

      if (action === 'set') {
        const hex = color.trim().toLowerCase();
        if (!isValidHexColor(hex)) throw new Error(t('settings.voice.conversationThemeBadColor'));
        await commit({ ...stored.colors, [key]: hex });
        return t('settings.voice.conversationThemeSet', { target: t(`settings.voice.conversationThemeTarget.${key}`) });
      }

      const label = normalizePaletteName(name);
      if (label.length === 0) throw new Error(t('settings.voice.conversationThemeNoName'));

      if (action === 'save') {
        // Oldest first, so a library kept out loud never grows without bound.
        const kept = Object.entries(palettes).slice(-(MAX_THEME_PALETTES - 1));
        const next = Object.fromEntries([...kept, [label, stored.colors]]);
        await configService.set(THEME_PALETTES_CONFIG_KEY, next);
        return t('settings.voice.conversationThemeSaved', { name: label });
      }

      if (action === 'use') {
        const found = palettes[label];
        if (!found) throw new Error(t('settings.voice.conversationThemeUnknownName', { name: label }));
        await commit(found);
        return t('settings.voice.conversationThemeUsed', { name: label });
      }

      throw new Error(t('settings.voice.conversationActionUnsupported'));
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
      // The whole display, not `session.screenshotSource`. That setting governs
      // the screenshot quietly attached to *every* spoken turn, and defaults to
      // this window for the obvious reason. This is the other case: the user has
      // just said "look at my screen", and answering with a photograph of the
      // app they are talking to is answering a question nobody asked.
      source: 'screen',
    });
  }, []);

  /**
   * Says "still on it" now and then, while a long task runs.
   *
   * Spoken only into an actual silence: not while the user is talking, not over
   * an answer, and never twice on top of itself. The first one waits, because a
   * task that finishes quickly should just finish — an assistant that announces
   * it is working on something it has already done is worse than one that says
   * nothing.
   *
   * Returns the way to stop it, which the caller must always run: a heartbeat
   * that outlives its task talks about work nobody is doing.
   */
  const startWorkingHeartbeat = useCallback((): (() => void) => {
    let stopped = false;

    const beat = (): void => {
      if (stopped) return;
      // Only into a gap. `listening` is the one phase where nothing is being
      // said and nothing is being heard.
      if (phaseRef.current === 'listening' && !standbyRef.current) {
        void localRef.current?.speakAside(t('settings.voice.conversationStillWorking'));
      }
    };

    const first = window.setTimeout(() => {
      beat();
      repeat = window.setInterval(beat, HEARTBEAT_EVERY_MS);
    }, HEARTBEAT_FIRST_MS);
    let repeat: number | null = null;

    return () => {
      stopped = true;
      window.clearTimeout(first);
      if (repeat !== null) window.clearInterval(repeat);
    };
  }, [t]);

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

        if (event.name === 'app_theme') {
          const detail = await applyThemeAction(
            typeof args.action === 'string' ? args.action : '',
            typeof args.target === 'string' ? args.target : 'accent',
            typeof args.color === 'string' ? args.color : '',
            typeof args.name === 'string' ? args.name : ''
          );
          updateActivity(event.callId, { detail, state: 'completed' });
          backToListening();
          return { ok: true, detail };
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

        if (event.name === 'app_open_url') {
          // `urls` is the schema; `url` is what a small local model sends anyway.
          // Both are read, and only web addresses survive — see `parseOpenUrls`.
          const urls = parseOpenUrls(args.urls ?? args.url);
          if (urls.length === 0) throw new Error(t('settings.voice.conversationActionUnsupported'));

          // In order and one at a time. "Open each of those in turn" is a
          // sequence the user asked for, and the browser stacks tabs in the
          // order it is handed them.
          for (const url of urls) await ipcBridge.shell.openExternal.invoke(url);

          updateActivity(event.callId, {
            detail:
              urls.length === 1
                ? t('settings.voice.conversationOpened', { url: urls[0] })
                : t('settings.voice.conversationOpenedMany', { count: urls.length }),
            state: 'completed',
          });
          backToListening();
          // The count goes back so the model can say how many opened rather than
          // guessing, and notice when its list was longer than what was allowed.
          return { ok: true, opened: urls.length };
        }

        if (event.name === 'app_ask_jester') {
          const request = typeof args.request === 'string' ? args.request.trim() : '';
          if (request.length === 0) throw new Error(t('settings.voice.conversationActionUnsupported'));
          updateActivity(event.callId, { detail: t('settings.voice.conversationDelegated'), state: 'running' });
          // Back to listening *before* awaiting: the task runs for minutes and
          // the user has to be able to keep talking while it does. This is the
          // whole reason it is not the old navigate-and-prefill.
          backToListening();
          // Something to hear while it works. Minutes of silence from a voice
          // that was talking a moment ago reads as a crash — the user asks
          // again, and now the same job is running twice.
          const stopHeartbeat = startWorkingHeartbeat();
          const outcome = await runAgentTask({
            request,
            settings: settingsRef.current,
            onProgress: (detail) => {
              if (detail.length > 0) updateActivity(event.callId, { detail, state: 'running' });
            },
          }).finally(stopHeartbeat);
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
    [applyPhase, applyThemeAction, lookAtScreen, publish, t, updateActivity]
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
    // The talk key goes back to the notch turn, which is what owns it when no
    // conversation is open.
    ipcBridge.foolVoice.conversationActive?.emit({ active: false });
    holdingRef.current = false;
    standbyRef.current = false;
    applyPhase('idle');
    publishVoiceStageOff();
  }, [applyPhase]);

  // Stopped when the page goes away, so a conversation cannot outlive the view
  // of it — an open microphone with nothing on screen is the worst outcome here.
  useEffect(() => stop, [stop]);

  /**
   * Right Ctrl, held, from the desktop-wide hook rather than from the window.
   *
   * A key handler on the page would only work while the app is focused, and the
   * whole point of holding a key to talk is to do it while looking at something
   * else — which is also when the assistant is asked to look at the screen.
   *
   * Subscribed for the life of the page, not only while a conversation runs:
   * the state has to be correct the moment one starts, and a key already down
   * when the conversation opens would otherwise never be seen going up.
   */
  useEffect(() => {
    const emitter = ipcBridge.foolVoice?.holdToTalk;
    if (typeof emitter?.on !== 'function') return;
    return emitter.on(({ holding }) => {
      holdingRef.current = holding;

      // Reaching for the key while it is talking means "my turn now". Holding
      // it opens the microphone either way, and without this the reply carries
      // on underneath — the user talks over a voice that is still going, and
      // both end up in the recording.
      if (holding && phaseRef.current === 'speaking') {
        localRef.current?.interrupt();
        outputRef.current?.flush();
        applyPhase('listening');
        publish('listening');
      }
    });
  }, [applyPhase, publish]);

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
      levelRef.current = level;
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

    const gate = createHoldGate();

    const microphone = new PcmMicrophone();
    await microphone.start({
      sampleRate: pipeline.inputSampleRate,
      deviceId: settingsRef.current.devices.inputDeviceId,
      // Called for the same block, immediately before `onAudio`, which is what
      // lets the verdict below be the one for the block being handed over.
      onLevel: (level) => {
        verdict = vad.push(level, performance.now());
        // Held: the key decides where the utterance starts and ends, and the
        // detector's opinion about the level is not consulted. Still shown, so
        // the ring reacts while the key is down.
        showLevel(level, settingsRef.current.activation.conversationHoldToTalk ? holdingRef.current : vad.isSpeaking());
      },
      onAudio: (audio) => {
        if (!settingsRef.current.activation.conversationHoldToTalk) {
          pipeline.pushAudio(audio, VAD_TO_PIPELINE[verdict]);
          return;
        }

        // The key, and nothing else. A detector cannot tell a keystroke from a
        // word, and the transcriber answers both with a confident sentence — so
        // while the key is up nothing is captured at all, which is the only
        // version of this with no false positives left in it.
        const held = gate.next(holdingRef.current);
        if (held === null) return;
        // Nothing to send with the close: the pipeline already holds every block
        // captured while the key was down.
        pipeline.pushAudio(held === 'utterance-ended' ? '' : audio, held);
      },
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
        // The socket providers run their own turn detection on whatever they
        // are sent, so holding the key here is simply not sending anything.
        onAudio: (audio) => {
          if (settingsRef.current.activation.conversationHoldToTalk && !holdingRef.current) return;
          client.appendAudio(audio);
        },
        onLevel: (level) =>
          showLevel(
            level,
            settingsRef.current.activation.conversationHoldToTalk ? holdingRef.current : level > SPEECH_LEVEL
          ),
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
    // From here the talk key is this conversation's microphone and nothing
    // else: it must not also be opening a notch turn behind it, nor grabbing a
    // screen region on two quick taps.
    ipcBridge.foolVoice.conversationActive?.emit({ active: true });

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
    level: levelRef,
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
