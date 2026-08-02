/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the voice loop is doing, coarse enough to show.
 *
 * The turn state machine in `foolVoice` has a dozen phases because it has to be
 * precise; a person watching the pet needs five words. This is that reduction,
 * and it is the only voice vocabulary the pet window and the caption window
 * know about.
 */
export type VoiceStage =
  | 'off'
  /** Waiting for the wake phrase, microphone open. */
  | 'listening'
  /** Speech is arriving right now. */
  | 'hearing'
  /** Turning what was said into text. */
  | 'processing'
  /** The agent is working on an answer. */
  | 'generating'
  /** Reading the answer back. */
  | 'speaking';

export type VoiceStageEvent = {
  stage: VoiceStage;
  /** Microphone level, 0..1, for the caption's waveform. Zero unless hearing. */
  level: number;
  /** What was understood, once it is understood. Empty before that. */
  transcript: string;
  /** The wake phrase, so the caption can say what it is waiting for. */
  phrase: string;
  /**
   * The app's current accent colour, as a hex string.
   *
   * Passed along rather than resolved in the other windows: the main window is
   * the one that knows the active theme *and* any colour the user overrode, so
   * the caption's waveform matches the app exactly.
   */
  accent: string;
  /**
   * Already-translated text for the two extra windows.
   *
   * Neither the pet nor the caption strip loads the i18n runtime — the main
   * window owns the language, so it sends words rather than keys.
   */
  stageLabel: string;
  hint: string;
  placeholder: string;
  /**
   * A transient line that replaces the stage word over the pet.
   *
   * For work the user would otherwise read as a hang: a local summary model
   * being loaded takes tens of seconds, and silence during that is
   * indistinguishable from a freeze. Empty the rest of the time. Already
   * translated, like the labels above.
   */
  notice: string;
  /**
   * True once the wake phrase has been heard and the turn is really going
   * somewhere.
   *
   * Passive listening is the pet's job — it sits there with the microphone open
   * all the while the pet is up. The caption strip is for a turn that is actually
   * happening, so it keys off this rather than off the microphone being open.
   */
  awake: boolean;
  /**
   * What the agent is doing about what was said, oldest first.
   *
   * This is the half of Fool's Control that behaves like a small chat window:
   * "creating a note", "writing to notes.txt", each line marked done as it
   * finishes. Already translated, like the labels above, because neither extra
   * window loads the i18n runtime.
   *
   * Empty for a turn that is only being transcribed — there is nothing to say
   * yet, and the notch stays collapsed.
   */
  activity: readonly VoiceActivityLine[];
  /**
   * What the assistant is saying back, as it is being said.
   *
   * The *spoken* text, not the written reply: what reaches the notch is what
   * `summarizeForSpeech` produced, so a long answer shows the short version that
   * is actually being read aloud rather than paragraphs nobody will hear. Empty
   * until there is one.
   */
  reply: string;
};

/** One thing the agent did, or is doing, during a spoken turn. */
export type VoiceActivityLine = {
  text: string;
  /** False while it is still running; the notch dims a line once it is done. */
  done: boolean;
};

/**
 * How many options a single keystroke can reach in the notch.
 *
 * The notch is read at a glance from across the room, and the keys are pressed
 * without looking at it. Three is what a person can hold in their head that way;
 * past that the numbering is doing more harm than the shortcut is worth, so a
 * fourth option is listed but has to be clicked in the app.
 */
export const MAX_NOTCH_CHOICE_KEYS = 3;

/**
 * A choice the agent is waiting on, mirrored into the notch.
 *
 * The whole point of hold-to-talk is that the user is looking at something else,
 * which is exactly when a permission request drawn only in the main window is
 * never seen and the turn simply stops. Everything here is already translated,
 * like the rest of what the notch is sent: that window loads no i18n runtime.
 */
export type VoicePermissionRequest = {
  /** Identifies the request. The same id twice is the same question, not a new one. */
  id: string;
  /** What is being asked. */
  title: string;
  /** How to answer it from the keyboard. */
  hint: string;
  /** The options in the order they are numbered. */
  options: readonly string[];
};

/**
 * What the notch window is actually sent.
 *
 * The stage is published by the voice loop and the request by the conversation;
 * they are two unrelated things that happen to share one small window, so they
 * are joined here at the edge rather than folded into each other's vocabulary.
 */
export type FoolsControlPayload = VoiceStageEvent & {
  permission: VoicePermissionRequest | null;
};

export const VOICE_STAGE_OFF: VoiceStageEvent = {
  stage: 'off',
  level: 0,
  transcript: '',
  phrase: '',
  accent: '#c4123f',
  stageLabel: '',
  hint: '',
  placeholder: '',
  notice: '',
  awake: false,
  activity: [],
  reply: '',
};

/** True while the microphone is open, whatever the loop is doing with it. */
export const isMicrophoneOpen = (stage: VoiceStage): boolean => stage !== 'off';

/**
 * Whether Fool's Control belongs on screen.
 *
 * Only for a turn in flight: the wake phrase has been heard, or the loop has
 * already moved past listening. Passive listening shows on the pet alone, so an
 * open microphone does not put a card over the user's screen all day.
 */
export const shouldShowCaption = (event: { stage: VoiceStage; awake: boolean }): boolean =>
  event.awake || event.stage === 'processing' || event.stage === 'generating' || event.stage === 'speaking';
