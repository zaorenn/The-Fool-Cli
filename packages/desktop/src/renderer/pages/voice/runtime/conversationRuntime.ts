/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  buildPersonaInstructions,
  REALTIME_PROVIDER_SPECS,
  REALTIME_TOOLS,
  type NormalizedRealtimeEvent,
  type RealtimeCredential,
  type RealtimeProviderId,
  type SpokenVoice,
  type VoiceConversationProviderId,
} from '@/common/realtime';
import { createHoldGate } from '@/common/voice/holdToTalkGate';
import { describeSpokenTurns, worthRemembering, type SpokenTurn } from '@/common/voice/sessionSummary';
import { appendTurn, resumedTurns, startConversation, type VoiceConversation } from '@/common/voice/conversationLog';
import { windowWhileSpeaking } from '@/common/voice/bargeIn';
import { notchLine } from '@/common/voice/notchLine';
import { saveConversation } from '@renderer/services/voice/session/conversationStore';
import { claimManualVoiceSession } from '@renderer/hooks/voice/useFoolVoiceSession';
import { AdaptiveVad, type VadEvent } from '@renderer/services/voice/AdaptiveVad';
import {
  publishVoiceActivity,
  publishVoiceReply,
  publishVoiceStage,
  publishVoiceStageOff,
} from '@renderer/services/voice/publishVoiceStage';
import {
  markVoiceIntroduced,
  peekVoiceMemory,
  readVoiceMemory,
  rememberVoiceSession,
} from '@renderer/services/voice/session/voiceMemoryStore';
import { peekVoiceSettings, subscribeVoiceSettings } from '@renderer/services/voice/voiceSettingsStore';
import { guardSpokenSentence } from '@renderer/services/voice/session/spokenOutput';
import { createTurnEvidence } from '@/common/voice/turnEvidence';
import { continuityFor } from '@/common/voice/sessionSummary';
import {
  CURIOSITY_REFUSALS_CONFIG_KEY,
  mayAskAbout,
  openSubjects,
  sanitizeRefusedSubjects,
} from '@/common/voice/memoryProposal';
import { asksForQuiet, asksToResume, isStillTyping, maySpeakUnprompted } from '@/common/voice/thinkingAloud';
import { configService } from '@/common/config/configService';
import type { ConversationFile } from '@/common/voice/conversationFiles';
import { LocalVoicePipeline } from '../localPipeline';
import { PcmAudioOutput, PcmMicrophone } from '../pcmAudio';
import { RealtimeVoiceClient } from '../RealtimeVoiceClient';
import { DelegatedTasks } from './delegatedTasks';
import { listSpokenVoices } from './settingsTool';
import { runVoiceTool } from './toolRunner';
import type { ConversationActivity, ConversationPhase, ToolHost, Translate } from './types';

/**
 * A spoken conversation, held outside React.
 *
 * This used to be a hook, and everything it owned — the microphone, the socket,
 * the speaker, the reply half-said — died with the component. Leaving the voice
 * page to look something up in another tab therefore ended the conversation,
 * which is exactly the moment someone is most likely to leave it: they asked for
 * something, and they went to watch it happen.
 *
 * So the conversation is a module-level object with subscribers, and the page is
 * a view onto it. Navigating away unsubscribes; it does not stop anything. The
 * only things that end a conversation now are the user saying so and the window
 * closing.
 *
 * Nothing here may reach for React. State changes are pushed to subscribers, and
 * the two things it needs from the app — the settings and the translations —
 * come from a module-level store and from a function the page lends it.
 */

/**
 * The notch speaks a coarser vocabulary than the page does.
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
 * Every block the pipeline emits does name one, so this is only what the speaker
 * is opened with before the first of them arrives.
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

/** How many activities are kept; the notch and the page show the same list. */
const MAX_ACTIVITIES = 8;

/**
 * How many finished turns are held for the session summary.
 *
 * Only the ends of a conversation are used to describe it, so this exists to
 * bound the memory of a conversation left running all day rather than to feed
 * the summary. Generous enough that nothing realistic reaches it.
 */
const MAX_REMEMBERED_TURNS = 200;

/**
 * How long the room stays quiet before the assistant may ask something.
 *
 * Comfortably past `QUIET_BEFORE_ASIDE_MS`, which is the floor the silence
 * contract enforces anyway. A question is the least urgent thing this assistant
 * ever says, so it waits longer than anything else does — long enough that the
 * user has plainly finished, short enough to still belong to the conversation
 * rather than arriving out of nowhere.
 */
const CURIOSITY_AFTER_MS = 8_000;

export type ConversationSnapshot = {
  phase: ConversationPhase;
  userTranscript: string;
  assistantTranscript: string;
  error: string;
  providerName: string;
  activities: readonly ConversationActivity[];
};

const IDLE_SNAPSHOT: ConversationSnapshot = {
  phase: 'idle',
  userTranscript: '',
  assistantTranscript: '',
  error: '',
  providerName: '',
  activities: [],
};

/** Until the page lends its own, keys pass through unchanged. */
const passthrough: Translate = (key) => key;

class ConversationRuntime {
  private snapshot: ConversationSnapshot = IDLE_SNAPSHOT;
  private readonly listeners = new Set<() => void>();

  private translate: Translate = passthrough;
  private interfaceLanguage = 'en-US';

  private client: RealtimeVoiceClient | null = null;
  /** Set instead of `client` when the conversation is assembled locally. */
  private local: LocalVoicePipeline | null = null;
  /** Ends the subscription that keeps a running conversation's settings current. */
  private releaseSettings: (() => void) | null = null;
  /**
   * Narrows the listening window while a reply is being spoken.
   *
   * Set when the local pipeline's microphone is opened; absent for the socket
   * providers, which capture on the far side of a socket and have no window
   * here to narrow.
   */
  private narrowVad: ((speaking: boolean) => void) | null = null;
  private microphone: PcmMicrophone | null = null;
  private output: PcmAudioOutput | null = null;
  /** Held for the length of the conversation, so nothing else opens capture. */
  private releaseMicrophoneClaim: (() => void) | null = null;

  /** True while waiting: audio still flows, nothing it says is let through. */
  private standby = false;
  /** When the conversation last fell quiet; null while anything is happening. */
  private quietSince: number | null = null;
  /**
   * Tasks handed to an agent that this conversation is not waiting for.
   *
   * Built lazily and thrown away with the conversation: a completion nobody is
   * in the room for has nowhere to go.
   */
  private delegated: DelegatedTasks | null = null;
  /** Whether right Ctrl is down right now, when hold-to-talk is switched on. */
  private holding = false;
  /**
   * When the keyboard hook last said somebody was typing.
   *
   * `-Infinity` rather than 0 so that on a machine where the native hook never
   * loaded — which is a supported state; the app loses hold-to-talk and keeps
   * everything else — the assistant is not permanently mid-sentence.
   */
  private lastTypedAt = Number.NEGATIVE_INFINITY;
  /**
   * The microphone's current level, for whatever is drawing it.
   *
   * A box rather than state: this changes many times a second, and putting it
   * through React would re-render the whole page for every audio block. The
   * meter reads it inside its own animation frame instead.
   */
  readonly level = { current: 0 };

  /** Unsubscribes the desktop-wide talk key, held for the app's lifetime. */
  private releaseHoldKey: (() => void) | null = null;

  /** And the request to open a conversation, which the same key makes. */
  private releaseStartKey: (() => void) | null = null;

  /** And the report that somebody is typing, from the same keyboard hook. */
  private releaseTyping: (() => void) | null = null;

  /** The installed voices, read once when a conversation opens. */
  private voices: readonly SpokenVoice[] = [];

  /**
   * What has been said this session, for the line the memory keeps about it.
   *
   * Collected here rather than in either transport, because both of them have
   * one and only one of them was writing it down. The local pipeline keeps a
   * history to think with and wrote a model-written summary from it; the socket
   * providers keep their history on the far side of a socket, so a conversation
   * on OpenAI Realtime or Gemini Live left no trace at all. Finished transcripts
   * pass through this object whichever transport produced them, so this is the
   * one place both are visible.
   */
  private spoken: SpokenTurn[] = [];

  /**
   * The same conversation, as it is being written down.
   *
   * Kept beside `spoken` rather than derived from it at the end, because the
   * end is exactly when it is least likely to arrive: a conversation is far
   * more often closed by the window going away or the machine being shut down
   * than by anybody pressing stop. Saved on every finished turn, so what
   * survives a crash is everything up to the crash.
   */
  private saved: VoiceConversation | null = null;

  /** What a resumed conversation carries in, until the session opens. */
  private carried: SpokenTurn[] = [];

  constructor() {
    this.listenForHoldKey();
    this.listenForStartRequest();
    this.listenForTyping();
  }

  // ---------------------------------------------------------------- subscribe

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ConversationSnapshot => this.snapshot;

  /**
   * Lends the runtime the page's translations and interface language.
   *
   * Called every time the page mounts. The function keeps working after it
   * unmounts, which is the property this depends on: a conversation still
   * running with nothing on screen must still be able to name what it is doing.
   */
  attach(translate: Translate, interfaceLanguage: string): void {
    this.translate = translate;
    this.interfaceLanguage = interfaceLanguage;
  }

  private emit(patch: Partial<ConversationSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of Array.from(this.listeners)) listener();
  }

  private get t(): Translate {
    return (key, values) => this.translate(key, values);
  }

  // -------------------------------------------------------------------- phase

  private get phase(): ConversationPhase {
    return this.snapshot.phase;
  }

  private applyPhase(next: ConversationPhase): void {
    // When the room last went quiet, which is what an interruption has to wait
    // for. `listening` is the one phase in which nobody is talking, so the clock
    // starts on entering it and is thrown away on leaving.
    if (next === 'listening') this.quietSince ??= Date.now();
    else this.quietSince = null;
    this.scheduleCuriosity(next);
    this.emit({ phase: next });
  }

  /**
   * Waits out the pause, then considers asking one thing.
   *
   * A timer rather than a check at the moment the turn ends, because the moment
   * a turn ends is the moment the user is most likely to say the next thing —
   * and a question landing on top of that is the interruption this whole layer
   * exists to avoid. The timer is armed on entering `listening` and thrown away
   * on leaving it, so speaking again cancels the question rather than queueing
   * it, and everything the contract checks is re-checked when it fires.
   */
  private scheduleCuriosity(next: ConversationPhase): void {
    if (this.curiosityTimer !== null) {
      window.clearTimeout(this.curiosityTimer);
      this.curiosityTimer = null;
    }
    if (next !== 'listening' || this.standby) return;

    this.curiosityTimer = window.setTimeout(() => {
      this.curiosityTimer = null;
      this.askSomethingAboutYou();
    }, CURIOSITY_AFTER_MS);
  }

  /** Milliseconds of quiet, or zero while anything is being said or heard. */
  private get quietForMs(): number {
    return this.quietSince === null ? 0 : Date.now() - this.quietSince;
  }

  /**
   * Puts the conversation on the notch, the pet and anything else watching.
   *
   * The same publisher the hold-to-talk loop uses, so a spoken conversation and
   * a spoken turn look identical from outside — which is the point: the user
   * does not think of them as two features.
   */
  private publish(next: ConversationPhase, extra?: { level?: number; transcript?: string }): void {
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
  }

  private enter(next: ConversationPhase, extra?: { level?: number; transcript?: string }): void {
    // Narrowed while a reply is being spoken and restored the moment it is not,
    // so the shorter window never applies to somebody dictating.
    this.narrowVad?.(next === 'speaking');
    this.applyPhase(next);
    this.publish(next, extra);
  }

  // --------------------------------------------------------------- activities

  /**
   * How many tools have come back since the user last spoke.
   *
   * The other half of the claim gate. A socket provider speaks its own audio,
   * so this runtime cannot refuse a sentence before it is heard the way the
   * local pipeline can — but it can stop the rest of a false claim and refuse
   * to write it down, which is the difference between a slip and a record.
   */
  private toolsRanThisTurn = 0;

  private updateActivity = (id: string, patch: Partial<ConversationActivity>): void => {
    if (patch.state === 'completed') this.toolsRanThisTurn += 1;
    const current = this.snapshot.activities;
    const existing = current.find((item) => item.id === id);
    const next = !existing
      ? [
          { id, label: patch.label ?? id, detail: patch.detail ?? '', state: patch.state ?? 'running' },
          ...current,
        ].slice(0, MAX_ACTIVITIES)
      : current.map((item) => (item.id === id ? { ...item, ...patch } : item));

    this.emit({ activities: next });
    this.publishActivities();
  };

  /**
   * Whether this reply claims something it has not earned.
   *
   * `remembered` is measured the same way the local pipeline measures it — the
   * length of what is actually written down — so the two surfaces cannot
   * disagree about whether there was anything to recall.
   */
  private refuses(text: string): boolean {
    const memory = peekVoiceMemory();
    const remembered = memory.user.trim().length + memory.agent.trim().length;
    return (
      guardSpokenSentence(text, {
        toolsRan: this.toolsRanThisTurn,
        remembered,
        lookedAtScreen: this.evidence.lookedAtScreen,
        startedPlayback: this.evidence.startedPlayback,
        appLaunchFailed: this.evidence.appLaunchFailed,
      }).speak === false
    );
  }

  /**
   * The newest thing this turn is doing, in the words the tool reported.
   *
   * Only a step still running: a completed one is something that *was* being
   * done, and saying "still opening the browser" about a browser that is open
   * is exactly the kind of small lie this application is built against.
   */
  private newestStep(): string | null {
    const running = this.snapshot.activities.find((item) => item.state === 'running');
    const said = (running?.detail || running?.label || '').trim();
    return said.length > 0 ? said : null;
  }

  /**
   * Puts the same list on the notch, oldest first.
   *
   * It is read top to bottom, and it sits beside the reply so the user can watch
   * the work and hear the answer at once rather than choosing between them.
   */
  private publishActivities(): void {
    publishVoiceActivity(
      [...this.snapshot.activities]
        .toReversed()
        .map((item) => ({ text: item.detail || item.label, done: item.state !== 'running' }))
    );
  }

  // -------------------------------------------------------------------- tools

  /**
   * Says "still on it" now and then, while a long task runs.
   *
   * Spoken only into an actual silence: not while the user is talking, not over
   * an answer, and never twice on top of itself.
   */
  private startWorkingHeartbeat = (): (() => void) => {
    let stopped = false;
    let repeat: number | null = null;

    const beat = (): void => {
      if (stopped) return;
      // Only into a gap. `listening` is the one phase where nothing is being
      // said and nothing is being heard.
      if (this.phase === 'listening' && !this.standby) {
        void this.local?.speakAside(this.t('settings.voice.conversationStillWorking'));
      }
    };

    const first = window.setTimeout(() => {
      beat();
      repeat = window.setInterval(beat, HEARTBEAT_EVERY_MS);
    }, HEARTBEAT_FIRST_MS);

    return () => {
      stopped = true;
      window.clearTimeout(first);
      if (repeat !== null) window.clearInterval(repeat);
    };
  };

  private get toolHost(): ToolHost {
    return {
      t: this.t,
      updateActivity: this.updateActivity,
      backToListening: () => this.enter('listening'),
      flushOutput: () => this.output?.flush(),
      setStandby: (waiting: boolean) => {
        this.standby = waiting;
        if (waiting) this.enter('standby');
      },
      // Only the local pipeline holds a conversation whose prompt this app
      // owns; a socket provider keeps its own on the far side. A rule set in one
      // of those is kept the same way, it simply cannot be re-asserted mid-call.
      setSessionRule: (rule: string) => this.local?.addSessionRule(rule),
      dropSessionRule: (about: string) => this.local?.dropSessionRule(about),
      startWorkingHeartbeat: this.startWorkingHeartbeat,
      announceLater: (what, finished) => this.asides.follow(what, finished),
    };
  }

  /**
   * The queue that volunteers a finished task, made on first use.
   *
   * On first use rather than on start because most conversations never delegate
   * anything, and a timer that exists for all of them is a timer that has to be
   * right about being idle.
   */
  private get asides(): DelegatedTasks {
    this.delegated ??= new DelegatedTasks({
      t: this.t,
      moment: () => ({
        phase: this.phase,
        standby: this.standby,
        quietForMs: this.quietForMs,
        hushed: this.hushed,
        enabled: peekVoiceSettings().activation.unpromptedSpeech,
        holdingToTalk: this.holding,
        userIsTyping: this.userIsTyping,
      }),
      // The same door the heartbeat uses, and it refuses for the same reasons:
      // an aside over an answer, or over the user, is worse than a late one.
      speak: (line) => void this.local?.speakAside(line),
      note: (line) => this.local?.noteAside(line),
    });
    return this.delegated;
  }

  private runTool = async (invocation: {
    callId: string;
    name: string;
    argumentsJson: string;
  }): Promise<Record<string, unknown>> => {
    this.enter('acting');
    this.updateActivity(invocation.callId, {
      label: invocation.name,
      detail: this.t('settings.voice.conversationActionRunning'),
      state: 'running',
    });
    const result = await runVoiceTool(this.toolHost, invocation);
    // Weighed, not counted. A look that came back with an error is a call with
    // no screen in it, and the gate has to be able to tell those apart — that is
    // the whole difference between "a tool ran" and "it has seen something".
    this.evidence.observe(invocation.name, result);
    // Read from the result for the same reason a look is: `app_play` answers
    // with the address it opened instead when nothing is connected, and that
    // call ran just as successfully while nothing became audible.
    return result;
  };

  /**
   * Whether a screen has genuinely been seen since this conversation started.
   *
   * Unlike {@link toolsRanThisTurn} this is *not* reset per turn, and the
   * asymmetry is deliberate: a tool from five minutes ago must not vouch for a
   * claim made now, but a screenshot from five minutes ago is still in the
   * history and the model may still refer to what was in it.
   */
  /** The three facts the gates need, derived in one place for both runtimes. */
  private readonly evidence = createTurnEvidence();

  /**
   * Whether a player has reported this conversation that something is on.
   *
   * Not reset per turn, and for the same reason `sawScreen` is not: a song
   * started three turns ago is still playing, and answering "yes, that is the
   * one that is on" is a report rather than a claim.
   */
  private playbackStarted = false;
  /** Whether the last launch this turn failed. Cleared by one that succeeds. */
  private appLaunchFailed = false;

  /**
   * Told to stop volunteering things, for the rest of this conversation.
   *
   * Per conversation rather than persisted, and that is the right life for it: a
   * hush is about this moment — somebody is on a call, somebody is concentrating
   * — not about how they want the assistant to behave for ever. The setting is
   * where "for ever" belongs.
   *
   * It silences only what nobody asked for. Answering a question is not
   * volunteering, and an assistant that stopped replying because it was told to
   * be quiet would have understood the wrong thing entirely.
   */
  private hushed = false;

  // ------------------------------------------------------------------- events

  private handleEvent = (event: NormalizedRealtimeEvent): void => {
    switch (event.kind) {
      case 'ready':
        break;
      case 'user-transcript': {
        // A new thing asked is a new turn, and the evidence starts again with
        // it. Counting across turns would let a tool from five minutes ago
        // vouch for a claim made now.
        if (event.final) {
          this.toolsRanThisTurn = 0;
          // Heard here rather than handed to the model, because "be quiet" is
          // the one instruction that must not depend on the model choosing to
          // honour it — and the model is about to answer this turn anyway, which
          // is correct: being told to stop volunteering things is not being told
          // to stop replying.
          if (asksForQuiet(event.text)) this.hushed = true;
          else if (asksToResume(event.text)) this.hushed = false;
        }
        const heard = event.final ? event.text : `${this.snapshot.userTranscript}${event.text}`;
        this.emit({
          userTranscript: heard,
          // The assistant's last line is cleared only once the user has finished
          // saying something: clearing it on the first partial would blank the
          // screen every time they cleared their throat.
          //
          // Finished steps go with it; still-running ones stay. A task handed to
          // the agent outlives the question that started it — that is the whole
          // reason it runs in the background — so a new question must not wipe
          // the only sign that the last one is still being worked on.
          ...(event.final
            ? {
                assistantTranscript: '',
                activities: this.snapshot.activities.filter((item) => item.state === 'running'),
              }
            : {}),
        });
        // The whole sentence so far, not the fragment that just arrived. The
        // notch shows this for the length of the turn — it is the "what am I
        // working on" line — and a surface fed only the last delta showed three
        // words of a question and then held them there while it answered.
        this.publish(this.phase === 'idle' ? 'listening' : this.phase, { transcript: heard });
        if (event.final) {
          this.publishActivities();
          this.record('user', heard);
        }
        break;
      }
      case 'assistant-transcript': {
        if (this.standby || (event.final && event.text.length === 0)) break;
        // The one gate every spoken surface passes through. A speech-to-speech
        // provider has already begun saying this, so the best that can be done
        // is stop the rest of it and keep it out of the record — a claim nobody
        // can read back later is not one the assistant gets to stand behind.
        if (event.final && this.refuses(event.text)) {
          this.output?.flush();
          publishVoiceReply('');
          break;
        }
        const next = event.final ? event.text : `${this.snapshot.assistantTranscript}${event.text}`;
        this.emit({ assistantTranscript: next });
        // A short line, not the whole stream. The notch is a strip a few
        // centimetres wide over whatever the user is doing; handed the entire
        // reply it grew into a wall of text, and handed the agent's own output
        // it became a list of markdown fragments.
        publishVoiceReply(notchLine(next));
        if (event.final) this.record('assistant', next);
        break;
      }
      case 'audio':
        // Nothing reaches the speaker while waiting. The instruction to stay
        // silent is the model's to follow, and this is what makes it true even
        // when it does not: a stray reply is dropped rather than played into a
        // room where the user asked for quiet.
        if (this.standby) break;
        if (this.phase !== 'acting') this.enter('speaking');
        void this.output?.enqueue(event.pcm16Base64, event.sampleRate);
        break;
      case 'interrupted':
        // Barge-in. Whatever is queued for the speaker is no longer wanted; the
        // model has already stopped producing it on its own side.
        this.output?.flush();
        break;
      case 'phase':
        if (this.phase === 'acting' || this.standby) break;
        this.enter(event.phase === 'acting' ? 'acting' : event.phase);
        break;
      case 'tool-call':
        void this.runSocketToolCall(event);
        break;
      case 'error':
        this.emit({
          error: this.t(`settings.voice.conversationError.${event.message}`, { defaultValue: event.message }),
        });
        break;
    }
  };

  /** The socket path: run it, then post the result back over the socket. */
  private async runSocketToolCall(event: Extract<NormalizedRealtimeEvent, { kind: 'tool-call' }>): Promise<void> {
    const result = await this.runTool({
      callId: event.callId,
      name: event.name,
      argumentsJson: event.argumentsJson,
    });
    this.client?.sendToolResult(event.callId, event.name, result);
  }

  // ---------------------------------------------------------------- transport

  /**
   * The speaker, ready for whichever side is about to talk.
   *
   * `sampleRate` is the rate blocks are assumed to be at when they do not say; a
   * socket provider fixes one for the whole session, and the local pipeline
   * labels every block with the rate its voice model actually rendered at.
   */
  private openOutput(sampleRate: number): void {
    const settings = peekVoiceSettings();
    const output = new PcmAudioOutput();
    output.configure(sampleRate, settings.playback.volume);
    void output.setOutputDevice(settings.devices.outputDeviceId);
    output.onDrained = () => {
      if (this.phase === 'speaking') this.enter('listening');
    };
    this.output = output;
  }

  /**
   * Draws the level meter, for as long as the floor is the user's.
   *
   * A meter that moves during the reply is drawing the echo the canceller is
   * already removing, which reads as the assistant interrupting itself.
   */
  private showLevel(level: number, speaking: boolean): void {
    this.level.current = level;
    if (this.phase !== 'listening' && this.phase !== 'hearing') return;
    const next = speaking ? 'hearing' : 'listening';
    if (next !== this.phase) this.applyPhase(next);
    this.publish(next, { level });
  }

  /**
   * A conversation assembled here rather than held with a server.
   *
   * The one structural difference is who notices that the user stopped talking:
   * a hosted provider does it at its end and streams audio continuously, and
   * here the app has to, so the same detector the hold-to-talk loop uses runs
   * over the level meter and hands the pipeline its verdict with every block.
   */
  private async startLocal(): Promise<void> {
    const settings = peekVoiceSettings();
    const pipeline = new LocalVoicePipeline({
      settings,
      interfaceLanguage: this.interfaceLanguage,
      voices: this.voices,
      carried: this.carried,
      onEvent: this.handleEvent,
      // The same tools the socket providers are given, run by the same code. A
      // local conversation that could not look at the screen or do anything on
      // the computer was the difference the user could feel between the two.
      runTool: (call) => this.runTool(call),
      // The newest thing the turn is doing, so a line said into a silence can
      // name it. The activity list already holds it; nothing else had ever read
      // it back out.
      currentStep: () => this.newestStep(),
    });
    await pipeline.connect();
    this.local = pipeline;

    // Which brain actually answered, rather than which class holds the
    // microphone. This said "local pipeline" whatever happened — when every
    // word came from the same agent as typed chat, and when it had quietly
    // fallen back to a small local model because no session could be opened.
    // One label for two very different things is a label that means nothing,
    // and it is how somebody spends an evening deciding the assistant got worse.
    this.emit({
      providerName: pipeline.thinksOnAgentRuntime
        ? this.t('settings.voice.conversationProviderName.agent')
        : this.t('settings.voice.conversationProviderName.local-pipeline'),
    });

    // Anything changed from here on reaches the conversation that is already
    // running. The pipeline was handed one copy of the settings above and would
    // otherwise keep it for the whole session, so "switch to a male voice" —
    // heard, written down and confirmed out loud — took effect only after a
    // restart. Both routes arrive here: the settings page and the spoken
    // commands write to the same store.
    this.releaseSettings?.();
    this.releaseSettings = subscribeVoiceSettings((next) => pipeline.updateSettings(next));

    this.openOutput(LOCAL_OUTPUT_FALLBACK_RATE);

    const vad = new AdaptiveVad(settings.vad);
    // While a reply is being spoken the microphone stops waiting for a
    // sentence: what it is listening for is somebody cutting in, and that is one
    // word. See `common/voice/bargeIn.ts` for the whole of the reasoning and
    // for what this does *not* achieve.
    this.narrowVad = (speaking: boolean): void => {
      const configured = peekVoiceSettings().vad;
      vad.useWindow(speaking ? windowWhileSpeaking(configured) : configured);
    };
    // The room, not the last conversation: the device may have changed, and the
    // floor a previous session settled on is not evidence about this one.
    vad.recalibrate();
    let verdict: VadEvent = 'idle';

    const gate = createHoldGate();

    const microphone = new PcmMicrophone();
    await microphone.start({
      sampleRate: pipeline.inputSampleRate,
      deviceId: settings.devices.inputDeviceId,
      // Called for the same block, immediately before `onAudio`, which is what
      // lets the verdict below be the one for the block being handed over.
      onLevel: (level) => {
        verdict = vad.push(level, performance.now());
        // Held: the key decides where the utterance starts and ends, and the
        // detector's opinion about the level is not consulted. Still shown, so
        // the meter reacts while the key is down.
        this.showLevel(level, peekVoiceSettings().activation.conversationHoldToTalk ? this.holding : vad.isSpeaking());
      },
      onAudio: (audio) => {
        if (!peekVoiceSettings().activation.conversationHoldToTalk) {
          pipeline.pushAudio(audio, VAD_TO_PIPELINE[verdict]);
          return;
        }

        // The key, and nothing else. A detector cannot tell a keystroke from a
        // word, and the transcriber answers both with a confident sentence — so
        // while the key is up nothing is captured at all, which is the only
        // version of this with no false positives left in it.
        const held = gate.next(this.holding);
        if (held === null) return;
        // Nothing to send with the close: the pipeline already holds every block
        // captured while the key was down.
        pipeline.pushAudio(held === 'utterance-ended' ? '' : audio, held);
      },
    });
    this.microphone = microphone;
  }

  /** A conversation held with a speech-to-speech server over a socket. */
  private async startRemote(providerId: RealtimeProviderId): Promise<void> {
    const settings = peekVoiceSettings();
    const realtime = settings.realtime;
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
    this.emit({ providerName: response.data.providerName });

    const client = new RealtimeVoiceClient({
      credential,
      config: {
        model,
        voice: realtime.voice || spec.defaultVoice,
        instructions: buildPersonaInstructions({
          presetId: realtime.personaPresetId,
          customInstructions: realtime.customInstructions,
          language: realtime.language,
          interfaceLanguage: this.interfaceLanguage,
          // The same phrase the pet answers to, so there is one thing to say to
          // this app rather than one per feature.
          wakePhrase: settings.activation.wakePhrase.phrase,
          memory: peekVoiceMemory(),
          carried: this.carried,
          voices: this.voices,
        }),
        language: realtime.language,
        tools: REALTIME_TOOLS,
      },
      onEvent: this.handleEvent,
    });
    await client.connect();
    this.client = client;

    this.openOutput(client.outputSampleRate);

    const microphone = new PcmMicrophone();
    await microphone.start({
      sampleRate: client.inputSampleRate,
      deviceId: settings.devices.inputDeviceId,
      // The socket providers run their own turn detection on whatever they are
      // sent, so holding the key here is simply not sending anything.
      onAudio: (audio) => {
        if (peekVoiceSettings().activation.conversationHoldToTalk && !this.holding) return;
        client.appendAudio(audio);
      },
      onLevel: (level) =>
        this.showLevel(
          level,
          peekVoiceSettings().activation.conversationHoldToTalk ? this.holding : level > SPEECH_LEVEL
        ),
    });
    this.microphone = microphone;
  }

  // ------------------------------------------------------------------ control

  /**
   * Takes what was dropped on the window into the conversation.
   *
   * Only the local pipeline holds a prompt this app owns; a socket provider
   * keeps its own on the far side and cannot be told mid-call. Answering `false`
   * rather than pretending, so the page can say so instead of leaving somebody
   * waiting for an assistant that never received the file.
   */
  hold = (files: readonly ConversationFile[]): boolean => {
    if (!this.local || files.length === 0) return false;
    this.local.holdFiles(files);
    return true;
  };

  start = async (): Promise<void> => {
    if (this.phase !== 'idle') return;

    this.emit({ error: '', userTranscript: '', assistantTranscript: '', activities: [] });
    this.standby = false;
    this.enter('connecting');
    // Claimed before the socket rather than after the microphone: the wake-word
    // listener has to have stood down before this conversation opens capture,
    // not while it is already running.
    this.releaseMicrophoneClaim ??= claimManualVoiceSession();
    // From here the talk key is this conversation's microphone and nothing else:
    // it must not also be opening a notch turn behind it, nor grabbing a screen
    // region on two quick taps.
    ipcBridge.foolVoice.conversationActive?.emit({ active: true });

    try {
      // Before the persona is built, because the persona *is* the memory on a
      // first run: it is what turns "hello, how can I help" into "hello — what
      // should I call you?".
      await readVoiceMemory();
      // Read once per conversation rather than per turn: installing a voice is
      // something the user does in a settings page, not mid-sentence, and asking
      // the catalog on every turn would put a disk read in the reply path.
      // An empty list simply means the voice cannot be changed by speaking,
      // which is better than a conversation that will not start.
      this.voices = await listSpokenVoices().catch((): readonly SpokenVoice[] => []);

      const providerId = peekVoiceSettings().realtime.providerId as VoiceConversationProviderId;
      if (providerId === 'local-pipeline') await this.startLocal();
      else await this.startRemote(providerId);

      this.enter('listening');
      // Recorded now rather than when the conversation ends: a session that is
      // cut short still happened, and being asked your name again every time you
      // hang up early is worse than missing one follow-up question.
      void markVoiceIntroduced();
      this.pickUpWhereWeLeftOff();
    } catch (startError) {
      const code = startError instanceof Error ? startError.message : String(startError);
      this.stop();
      this.emit({ error: this.t(`settings.voice.conversationError.${code}`, { defaultValue: code }) });
    }
  };

  /**
   * One sentence about last time, at the start of a conversation.
   *
   * The whole of what makes an assistant feel like it knows you, and the
   * cheapest thing in this file. Said once, at the opening, and never mentioned
   * again — this is a greeting, not a summary, and a second sentence about
   * yesterday is somebody reading their notes at you.
   *
   * **Built here rather than asked for.** A model told to mention the last
   * conversation will mention one whether or not there was one, and will
   * improve on it: the date drifts and the subject grows detail nobody
   * supplied. None of the honesty gates catch that — `isEmptyRecall` fires on an
   * *empty* memory, and this memory is not empty, it is being embellished. So
   * the sentence is assembled from the stored line word for word.
   *
   * It does not go through `maySpeakUnprompted`: the user opened this
   * conversation a second ago, so nothing is being interrupted and nobody is
   * being surprised. What would be wrong is saying it into a conversation that
   * is already under way, which is why it happens here and only here.
   */
  private pickUpWhereWeLeftOff(): void {
    const opener = continuityFor(peekVoiceMemory().user);
    if (opener === null) return;

    const line = this.t(
      opener.when === 'recent'
        ? 'settings.voice.conversationLastTimeRecent'
        : 'settings.voice.conversationLastTimeOlder',
      { what: opener.summary }
    );
    if (typeof line !== 'string' || line.trim().length === 0) return;

    // Through `speakAside`, which is the one path that speaks without a turn
    // behind it. It is also the only surface with a voice already resolved at
    // this point in the start-up, which is why a socket provider gets the line
    // spoken by the local voice rather than not at all.
    void this.local?.speakAside(line.trim());
    this.emit({ assistantTranscript: line.trim() });
  }

  /** Subjects asked about in this conversation, so the per-session limit means something. */
  private askedThisSession = 0;

  /** The pending "may I ask something" check, cancelled whenever anyone speaks. */
  private curiosityTimer: number | null = null;

  /** One subject, in the form the silence contract dedups on. */
  private static askedKey = (subjectId: string): string => `curiosity:${subjectId}`;

  /**
   * Asking one thing about the person, at most once, and never twice ever.
   *
   * The gap this closes is not a missing feature so much as a missing wire:
   * `openSubjects` and `mayAskAbout` were written and tested and nothing in the
   * application called either, so an assistant designed to get to know somebody
   * never asked them anything.
   *
   * Three rules decide it and all three are here rather than in the prompt. A
   * model asked to "get to know the user" invents the premise — *you mentioned
   * you work in finance* — and none of the honesty gates catch an embellished
   * question, because the memory it is embellishing is not empty. So the
   * question is a written sentence chosen by subject, the same way
   * `pickUpWhereWeLeftOff` assembles its opener word for word.
   *
   * Both doors have to open: `maySpeakUnprompted` decides whether speaking
   * unasked is acceptable at this moment at all, `mayAskAbout` decides whether
   * *a question* is, which is stricter. And the subject is written down as
   * asked, not as answered — a question ignored once was an answer.
   */
  private askSomethingAboutYou(): void {
    if (this.askedThisSession >= 1) return;

    const refused = new Set(sanitizeRefusedSubjects(configService.get(CURIOSITY_REFUSALS_CONFIG_KEY)));
    const subject = openSubjects(peekVoiceMemory(), [...refused])[0];
    if (!subject) return;

    const asking = mayAskAbout({
      subject: subject.id,
      askedThisSession: this.askedThisSession,
      // A question during a task is not curiosity, it is an interruption of the
      // thing that was actually asked for.
      midTask: this.phase !== 'listening' || this.standby,
      refusedSubjects: refused,
    });
    if (!asking) return;

    const allowed = maySpeakUnprompted({
      // Deliberately not one of the owed reasons: nobody is waiting for this,
      // so it spends from the hourly budget like any other remark that was
      // nobody's idea but the assistant's.
      reason: 'curiosity',
      about: ConversationRuntime.askedKey(subject.id),
      enabled: peekVoiceSettings().activation.unpromptedSpeech,
      hushed: this.hushed,
      phase: this.phase,
      standby: this.standby,
      holdingToTalk: this.holding,
      userIsTyping: this.userIsTyping,
      quietForMs: this.quietForMs,
      sinceVolunteeredMs: this.askedThisSession > 0 ? 0 : Number.POSITIVE_INFINITY,
      volunteeredInLastHour: this.askedThisSession,
      // The subjects already spent, in the same form as `about`, so the
      // contract's own "never twice" rule covers this too rather than relying
      // on the check above to be the only one.
      alreadySaid: new Set([...refused].map(ConversationRuntime.askedKey)),
    });
    if (!allowed.speak) return;

    const line = this.t(`settings.voice.conversationCuriosity.${subject.id}`);
    if (typeof line !== 'string' || line.trim().length === 0) return;

    this.askedThisSession += 1;
    // Recorded before it is spoken. If speaking throws, the subject has still
    // had its turn — a question asked into a failure is not one to repeat.
    void configService.set(CURIOSITY_REFUSALS_CONFIG_KEY, [...refused, subject.id]).catch(() => {});
    void this.local?.speakAside(line.trim());
    this.emit({ assistantTranscript: line.trim() });
  }

  /** Keeps one finished turn, bounded so a long conversation is not a leak. */
  private record(role: SpokenTurn['role'], text: string): void {
    const line = text.trim();
    if (line.length === 0) return;
    this.spoken.push({ role, text: line });
    if (this.spoken.length > MAX_REMEMBERED_TURNS) this.spoken = this.spoken.slice(-MAX_REMEMBERED_TURNS);

    // Written down as it is said, not at the end. A spoken conversation is
    // usually ended by the window closing rather than by anyone pressing stop,
    // and a transcript that only exists at teardown is a transcript that is
    // usually not there. Failures are the store's to swallow — nothing about
    // saving history is worth interrupting the conversation for.
    this.saved = appendTurn(this.saved ?? startConversation(crypto.randomUUID(), Date.now()), { role, text: line });
    void saveConversation(this.saved).catch((e: unknown) => console.warn('Unhandled promise rejection:', e));
  }

  /**
   * Opens the next conversation carrying the end of an earlier one.
   *
   * The tail, not the whole thing: this becomes context for the session about
   * to start, and a long transcript pushed in whole would crowd out what is
   * about to be said. Deliberately a *new* conversation rather than an
   * append to the old one — the old one happened, and rewriting it days later
   * would make the list lie about when things were said.
   */
  resume = (conversation: VoiceConversation): void => {
    this.carried = resumedTurns(conversation);
    void this.start();
  };

  /**
   * Writes the line this conversation leaves behind, whichever way it was held.
   *
   * The local pipeline is preferred where it exists, because it has a model on
   * this machine that can be asked to summarise for nothing. Every other
   * provider falls back to what was actually said — worse than a written
   * summary, and enormously better than what it replaced, which was silence.
   */
  private rememberThisConversation(): void {
    if (this.local) {
      void this.local.rememberConversation();
      return;
    }
    if (!worthRemembering(this.spoken)) return;
    const summary = describeSpokenTurns(this.spoken);
    if (summary.length > 0) void rememberVoiceSession(summary);
  }

  stop = (): void => {
    // Before anything is torn down: the summary is written from the history the
    // pipeline is holding, and closing it throws that away.
    this.rememberThisConversation();
    this.spoken = [];
    // The transcript is already saved — every turn wrote itself as it finished.
    // All that is left is to mark when it ended, and to make sure the next
    // conversation starts as a new one rather than appending to this.
    if (this.saved && this.saved.turns.length > 0) {
      void saveConversation({ ...this.saved, endedAtMs: Date.now() }).catch((e: unknown) =>
        console.warn('Unhandled promise rejection:', e)
      );
    }
    this.saved = null;
    this.carried = [];
    // A task may still be running out there, and it is welcome to finish — but
    // there is nobody left to tell, and a queue holding a closed pipeline is a
    // timer nothing will ever clear.
    this.delegated?.close();
    this.delegated = null;
    if (this.curiosityTimer !== null) {
      window.clearTimeout(this.curiosityTimer);
      this.curiosityTimer = null;
    }
    // A new conversation gets its one question back; the store is what stops
    // the same subject being asked in it.
    this.askedThisSession = 0;
    this.microphone?.stop();
    this.microphone = null;
    this.client?.disconnect();
    this.client = null;
    this.releaseSettings?.();
    this.releaseSettings = null;
    this.local?.close();
    this.local = null;
    this.output?.close();
    this.output = null;
    this.releaseMicrophoneClaim?.();
    this.releaseMicrophoneClaim = null;
    // The talk key goes back to the notch turn, which is what owns it when no
    // conversation is open.
    ipcBridge.foolVoice.conversationActive?.emit({ active: false });
    this.holding = false;
    this.standby = false;
    this.applyPhase('idle');
    publishVoiceStageOff();
  };

  /** Cuts a reply short by hand, for when the user would rather press a button. */
  interrupt = (): void => {
    this.output?.flush();
    this.client?.interrupt();
    this.local?.interrupt();
    this.enter('listening');
  };

  setError = (message: string): void => {
    this.emit({ error: message });
  };

  /**
   * Right Ctrl, held, from the desktop-wide hook rather than from the window.
   *
   * A key handler on the page would only work while the app is focused, and the
   * whole point of holding a key to talk is to do it while looking at something
   * else — which is also when the assistant is asked to look at the screen.
   *
   * Subscribed once for the life of the app, not per conversation: the state has
   * to be correct the moment one starts, and a key already down when the
   * conversation opens would otherwise never be seen going up.
   */
  /**
   * The talk key, pressed when there is no conversation.
   *
   * The key used to open a dictation turn at the notch when nothing was
   * running, which is not what anybody presses it for now that there is a real
   * conversation to have. The decision is made in the main process — see
   * `holdToTalkActions` — and this is where it lands, because the page owns the
   * microphone and the provider and nothing in the main process can open one.
   *
   * Held for the app's lifetime alongside the key itself, so the press works
   * from the desktop or from inside another application. `start` is a no-op
   * unless the runtime is idle, so a second press during a conversation cannot
   * open a second one.
   */
  private listenForStartRequest(): void {
    const emitter = ipcBridge.foolVoice?.startConversation;
    if (typeof emitter?.on !== 'function') return;
    this.releaseStartKey = emitter.on(() => void this.start());
  }

  /**
   * Somebody typing, anywhere on the machine.
   *
   * The silence contract has had a `userIsTyping` field since it was written and
   * every caller passed `false`, because nothing in a spoken conversation could
   * see a keyboard in another window. The keyboard hook could — it reads every
   * keystroke for the combination rule — so the answer was one channel away the
   * whole time. What crosses it is the bare fact and nothing else.
   */
  private listenForTyping(): void {
    const emitter = ipcBridge.foolVoice?.typing;
    if (typeof emitter?.on !== 'function') return;
    this.releaseTyping = emitter.on(() => {
      this.lastTypedAt = Date.now();
    });
  }

  /** True while the user is mid-sentence at the keyboard. */
  private get userIsTyping(): boolean {
    return isStillTyping(Date.now() - this.lastTypedAt);
  }

  private listenForHoldKey(): void {
    const emitter = ipcBridge.foolVoice?.holdToTalk;
    if (typeof emitter?.on !== 'function') return;
    this.releaseHoldKey = emitter.on(({ holding }) => {
      this.holding = holding;

      // Reaching for the key while it is talking means "my turn now". Holding it
      // opens the microphone either way, and without this the reply carries on
      // underneath — the user talks over a voice that is still going, and both
      // end up in the recording.
      if (holding && this.phase === 'speaking') {
        this.local?.interrupt();
        this.output?.flush();
        this.enter('listening');
      }
    });
  }

  /** Tears everything down, for a test that wants a clean module. */
  reset(): void {
    this.stop();
    this.releaseHoldKey?.();
    this.releaseHoldKey = null;
    this.releaseTyping?.();
    this.releaseTyping = null;
    this.listeners.clear();
    this.snapshot = IDLE_SNAPSHOT;
    this.translate = passthrough;
  }
}

/**
 * The one conversation.
 *
 * A singleton rather than something created per page, because there is one
 * microphone and one speaker: two conversations would fight over both, and the
 * whole reason this module exists is that the page is no longer what owns it.
 */
export const conversationRuntime = new ConversationRuntime();
