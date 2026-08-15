/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { DEFAULT_ORB_SKIN } from '@/common/config/configKeys';
import { peekVoiceSettings } from '@renderer/services/voice/voiceSettingsStore';
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
/** What the assistant is saying back, for Fool's Control. */
let reply = '';

/**
 * How long a level update may wait to be coalesced.
 *
 * A timer, not an animation frame: this window is often minimised while the pet
 * is being talked to, and a minimised window paints nothing — an animation frame
 * that never arrives would leave the waveform frozen at whatever it last showed.
 * Roughly thirty a second is smooth and costs the same as a frame would.
 */
const COALESCE_MS = 33;

/**
 * How long a read of the accent is reused before the stylesheet is asked again.
 *
 * The accent changes when somebody picks a theme, which is a thing that happens
 * a few times in the life of an install. A tenth of a second is imperceptible
 * for that and is three whole audio blocks, which is the scale that matters
 * here.
 */
const ACCENT_CACHE_MS = 100;

let accent = VOICE_STAGE_OFF.accent;
let accentReadAt = 0;

/**
 * The accent the app is painting with right now, custom colours included.
 *
 * Cached, and this is not a micro-optimisation. `getComputedStyle` on the root
 * element forces the engine to resolve style synchronously, and this function
 * was called from `publishVoiceStage` — which the microphone calls **once per
 * audio block**. The capture worklet posts a block per render quantum, so at a
 * 16 kHz capture rate that is a forced style resolution about 125 times a
 * second, for the whole length of every conversation, on the thread that also
 * has to draw the meter and the page.
 *
 * Worse, it happened *before* the coalescing below rather than after it: the
 * throttle stopped the IPC and let every one of these through.
 */
const readAccent = (): string => {
  if (typeof document === 'undefined') return VOICE_STAGE_OFF.accent;

  const now = Date.now();
  if (now - accentReadAt < ACCENT_CACHE_MS) return accent;
  accentReadAt = now;

  const value = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim();
  accent = /^#[0-9a-f]{3,8}$/i.test(value) ? value : VOICE_STAGE_OFF.accent;
  return accent;
};

/**
 * Forgets the cached accent, so the next publish reads the stylesheet.
 *
 * For the moment a theme is applied: a hundred milliseconds is nothing while a
 * conversation is running and is very visible if the user changed the colour
 * *by speaking* and the notch kept the old one until the next audio block.
 */
export const forgetVoiceAccent = (): void => {
  accentReadAt = 0;
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
  (emitter as any).emit(event);
};

const flush = (): void => {
  frame = null;
  if (queued) {
    send(queued);
    queued = null;
  }
};

/**
 * The newest state, whether or not it has gone out yet.
 *
 * Everything that coalesces has to build on this rather than on `current`.
 * Building on `current` means the second thing queued in one tick silently
 * discards the first — a level update landing on top of a reply would take the
 * reply's own text back off the notch.
 */
const latest = (): VoiceStageEvent => queued ?? current;

/** Puts an event on the next tick, merged with whatever is already waiting. */
const enqueue = (patch: Partial<VoiceStageEvent>): void => {
  queued = { ...latest(), ...patch };
  frame ??= window.setTimeout(flush, COALESCE_MS);
};

/**
 * Sends now, taking anything waiting with it.
 *
 * For the things whose whole point is to arrive before the wait they describe.
 * Merged with the queue rather than built from `current`, because a level or a
 * reply already waiting is newer than `current` and would otherwise be undone.
 */
const sendNow = (patch: Partial<VoiceStageEvent>): void => {
  const event = { ...latest(), ...patch };
  queued = null;
  if (frame !== null) {
    window.clearTimeout(frame);
    frame = null;
  }
  send(event);
};

/**
 * Whether anything but the microphone level could have changed.
 *
 * The point of asking first is that the answer is "no" for almost every call:
 * the microphone publishes a level per audio block, and building the event to
 * find that out meant reading the stylesheet, the settings store and three
 * translations about a hundred times a second before throwing the result away.
 * The throttle below stopped the IPC and let every one of those through.
 *
 * Everything compared here is either an argument or a module-level value that
 * only a deliberate call replaces, so this cannot say "no" to a real change —
 * the expensive fields are all derived from exactly these.
 */
const onlyTheLevelMoved = (input: StageInput): boolean => {
  const pending = latest();
  return (
    input.stage === pending.stage &&
    (input.transcript ?? pending.transcript) === pending.transcript &&
    (input.phrase ?? pending.phrase) === pending.phrase &&
    (input.awake ?? false) === pending.awake &&
    notice === pending.notice &&
    activity === pending.activity &&
    reply === pending.reply
  );
};

export const publishVoiceStage = (input: StageInput): void => {
  // The common case, and the one on the audio path. Nothing is read from the
  // stylesheet, nothing is translated; the level rides the next tick.
  if (onlyTheLevelMoved(input)) {
    const level = input.level ?? 0;
    if (level !== latest().level) enqueue({ level });
    return;
  }

  const phrase = input.phrase ?? current.phrase;
  const key = STAGE_KEYS[input.stage];

  const event: VoiceStageEvent = {
    stage: input.stage,
    level: input.level ?? 0,
    // Kept until something replaces it. It used to be cleared by every publish
    // that did not restate it, which meant the request vanished from the notch
    // the instant the loop moved off transcription — so the one surface the user
    // is actually looking at showed the work without showing what it was for.
    // A caller that genuinely wants it gone passes an empty string.
    transcript: input.transcript ?? current.transcript,
    phrase,
    accent: readAccent(),
    // Sent for the same reason as the accent: the pet window draws the orb and
    // cannot read the setting that chooses it.
    orbSkin: peekVoiceSettings().session.orbSkin || DEFAULT_ORB_SKIN,
    // Translated here rather than in the other windows: they have no i18n
    // runtime, and this is the window that knows the chosen language.
    stageLabel: key ? i18next.t(key) : '',
    hint: input.stage === 'listening' ? i18next.t('conversation.chat.voice.stageHint', { phrase }) : '',
    placeholder: i18next.t('conversation.chat.voice.stagePlaceholder'),
    notice,
    awake: input.awake ?? false,
    activity,
    reply,
  };

  // A different stage, or new words, is news: send it now.
  const isNews =
    event.stage !== current.stage ||
    event.transcript !== current.transcript ||
    event.stageLabel !== current.stageLabel ||
    event.notice !== current.notice ||
    event.awake !== current.awake ||
    event.activity !== current.activity ||
    event.reply !== current.reply;

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
  enqueue(event);
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
  sendNow({ notice: text, accent: readAccent() });
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
  sendNow({ activity: lines, accent: readAccent() });
};

/**
 * Shows what the assistant is saying back.
 *
 * Given the spoken text rather than the written one: the notch is a read-out of
 * the turn that is happening out loud, and an answer that was summarised down to
 * a sentence before being read should appear as that sentence.
 */
export const publishVoiceReply = (text: string): void => {
  if (text === reply) return;
  reply = text;

  // Coalesced, unlike the notice and the activity list beside it. Those are
  // occasional; this one is called for **every frame of a streaming reply** —
  // the runtime recomputes the notch's line from the whole answer so far and
  // publishes it, which at a typical token rate is dozens of full IPC payloads
  // a second, each one waking the main process and a second renderer.
  //
  // A line of text arriving a thirtieth of a second late is not perceptible.
  // The stream stopping because the surface reading it could not keep up is.
  enqueue({ reply: text, accent: readAccent() });
};

export const clearVoiceNotice = (): void => {
  if (notice.length === 0) return;
  notice = '';
  sendNow({ notice: '', accent: readAccent() });
};

/** Used when a session ends, so no surface is left claiming to listen. */
export const publishVoiceStageOff = (): void => {
  queued = null;
  notice = '';
  activity = [];
  reply = '';
  if (frame !== null) {
    window.clearTimeout(frame);
    frame = null;
  }
  send({ ...VOICE_STAGE_OFF, accent: readAccent() });
};
