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
};

/** One thing the agent did, or is doing, during a spoken turn. */
export type VoiceActivityLine = {
  text: string;
  /** False while it is still running; the notch dims a line once it is done. */
  done: boolean;
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
