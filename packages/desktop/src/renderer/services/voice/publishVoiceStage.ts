/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  VOICE_STAGE_OFF,
  type VoiceActivityLine,
  type VoiceStage,
  type VoiceStageEvent,
} from '@/common/types/voiceStage';
import i18next from 'i18next';

/**
 * Tells the rest of the app what the voice loop is doing.
 *
 * The pet window and the caption strip have no voice code; they draw whatever
 * arrives here. Publishing from one place means the pose, the label and the
 * transcript are always the same moment rather than three near-misses.
 *
 * Level updates arrive per audio frame — roughly eight times a second — so they
 * are coalesced: a stage change goes out immediately, a level change waits for
 * the next tick.
 */

type StageInput = {
  stage: VoiceStage;
  level?: number;
  transcript?: string;
  phrase?: string;
  /** True once the wake phrase has been heard, so the strip may show itself. */
  awake?: boolean;
};

/** The word shown over the pet and on the strip for each stage. */
const STAGE_KEYS: Record<VoiceStage, string> = {
  off: '',
  listening: 'conversation.chat.voice.stageListening',
  hearing: 'conversation.chat.voice.stageHearing',
  processing: 'conversation.chat.voice.stageProcessing',
  generating: 'conversation.chat.voice.stageGenerating',
  speaking: 'conversation.chat.voice.stageSpeaking',
};

let current: VoiceStageEvent = VOICE_STAGE_OFF;
let queued: VoiceStageEvent | null = null;
let frame: number | null = null;
/** Survives stage changes: a model keeps loading while the loop moves on. */
let notice = '';
/**
 * What the agent is doing about the turn, for Fool's Control.
 *
 * Held here beside `notice` rather than passed on every call: the tool calls
 * that produce these lines arrive from a different part of the app than the
 * stage changes do, and threading them through every `publishVoiceStage` caller
 * would mean every caller having to know about them.
 */
let activity: readonly VoiceActivityLine[] = [];

/**
 * How long a level update may wait to be coalesced.
 *
 * A timer, not an animation frame: this window is often minimised while the pet
 * is being talked to, and a minimised window paints nothing — an animation frame
 * that never arrives would leave the waveform frozen at whatever it last showed.
 * Roughly thirty a second is smooth and costs the same as a frame would.
 */
const COALESCE_MS = 33;

/** Reads the accent the app is painting with right now, custom colours included. */
const readAccent = (): string => {
  if (typeof document === 'undefined') return VOICE_STAGE_OFF.accent;
  const value = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim();
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : VOICE_STAGE_OFF.accent;
};

/** Surfaces inside this window that draw the stage, e.g. the composer waveform. */
const listeners = new Set<(event: VoiceStageEvent) => void>();

/**
 * Watches the voice loop from inside the main window.
 *
 * The pet and the caption strip are separate windows and hear about this over
 * IPC; a control sitting next to the composer is in this window and would
 * otherwise have to round-trip through the bridge to learn what the loop three
 * modules away is doing.
 */
export const subscribeVoiceStage = (listener: (event: VoiceStageEvent) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const send = (event: VoiceStageEvent): void => {
  current = event;
  // Snapshot first: a listener may unsubscribe while being notified.
  for (const listener of Array.from(listeners)) listener(event);
  // The pet and the caption strip are desktop windows. In the browser build — and
  // anywhere the bridge is not wired — there is nothing to tell, and voice must
  // keep working regardless.
  const emitter = ipcBridge.foolVoice?.stage;
  if (typeof emitter?.emit !== 'function') return;
  emitter.emit(event);
};

const flush = (): void => {
  frame = null;
  if (queued) {
    send(queued);
    queued = null;
  }
};

export const publishVoiceStage = (input: StageInput): void => {
  const phrase = input.phrase ?? current.phrase;
  const key = STAGE_KEYS[input.stage];

  const event: VoiceStageEvent = {
    stage: input.stage,
    level: input.level ?? 0,
    transcript: input.transcript ?? '',
    phrase,
    accent: readAccent(),
    // Translated here rather than in the other windows: they have no i18n
    // runtime, and this is the window that knows the chosen language.
    stageLabel: key ? i18next.t(key) : '',
    hint: input.stage === 'listening' ? i18next.t('conversation.chat.voice.stageHint', { phrase }) : '',
    placeholder: i18next.t('conversation.chat.voice.stagePlaceholder'),
    notice,
    awake: input.awake ?? false,
    activity,
  };

  // A different stage, or new words, is news: send it now.
  const isNews =
    event.stage !== current.stage ||
    event.transcript !== current.transcript ||
    event.stageLabel !== current.stageLabel ||
    event.notice !== current.notice ||
    event.awake !== current.awake ||
    event.activity !== current.activity;

  if (isNews) {
    queued = null;
    if (frame !== null) {
      window.clearTimeout(frame);
      frame = null;
    }
    send(event);
    return;
  }

  // Only the level moved: let it ride the next tick.
  queued = event;
  frame ??= window.setTimeout(flush, COALESCE_MS);
};

export const peekVoiceStage = (): VoiceStageEvent => current;

/**
 * Shows a line over the pet for work that has no stage of its own.
 *
 * Used for a local model being loaded: it can take the better part of a minute,
 * and a pet standing silently through it looks broken rather than busy. Sent
 * immediately — the point is to arrive before the wait, not with it.
 */
export const publishVoiceNotice = (text: string): void => {
  notice = text;
  send({ ...current, notice: text, accent: readAccent() });
};

/**
 * Replaces what Fool's Control says the agent is doing.
 *
 * The whole list every time, not an append: the caller owns the turn and knows
 * which lines are still true, and a surface that could only be added to would
 * keep showing a step that was abandoned. Sent immediately for the same reason
 * a notice is — it is the answer to "is this thing stuck?".
 */
export const publishVoiceActivity = (lines: readonly VoiceActivityLine[]): void => {
  activity = lines;
  send({ ...current, activity: lines, accent: readAccent() });
};

export const clearVoiceNotice = (): void => {
  if (notice.length === 0) return;
  notice = '';
  send({ ...current, notice: '', accent: readAccent() });
};

/** Used when a session ends, so no surface is left claiming to listen. */
export const publishVoiceStageOff = (): void => {
  queued = null;
  notice = '';
  activity = [];
  if (frame !== null) {
    window.clearTimeout(frame);
    frame = null;
  }
  send({ ...VOICE_STAGE_OFF, accent: readAccent() });
};
