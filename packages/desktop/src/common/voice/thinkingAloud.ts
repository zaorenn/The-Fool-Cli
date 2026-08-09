/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Not leaving somebody standing there.
 *
 * A spoken turn that calls tools can be quiet for twenty seconds. On screen
 * that is a spinner and a list of steps; in a room it is silence, and silence
 * is indistinguishable from the thing having crashed. People do not do this to
 * each other — asked something that takes a moment, a person says "hmm, bir
 * bakayım" and then "hâlâ bakıyorum" if it runs long, and the other person
 * waits happily. That is all this is.
 *
 * Three rules hold it to something a person would actually do:
 *
 * **Only into a silence.** Anything the assistant is already saying is more
 * useful than a filler, so a filler is never queued while there is real speech
 * to say. It fills a gap; it does not take a turn.
 *
 * **Less often the longer it goes.** Somebody who says "still working on it"
 * every four seconds is not reassuring, they are nagging. The gaps widen.
 *
 * **It says what it is doing when it knows.** "Hmm" is for the first pause,
 * before anything has happened. Once a tool has run there is something true to
 * say instead, and saying the true thing is always better.
 */

/** What kind of filler a moment calls for. */
export type ThinkingKind =
  /** The first pause, before anything has happened yet. */
  | 'thinking'
  /** It has been a while, and work is happening. */
  | 'working'
  /** It has been a long while. */
  | 'still'
  /** A delegated task finished while the conversation had moved on. */
  | 'aside';

/** What the turn looks like right now. */
export type ThinkingState = {
  /** Milliseconds since the turn began. */
  elapsedMs: number;
  /** Milliseconds since anything at all was said, filler included. */
  quietForMs: number;
  /** True when there is real speech queued or playing. */
  speaking: boolean;
  /** How many tools have come back. */
  toolsRan: number;
  /** How many fillers have already been said this turn. */
  saidSoFar: number;
};

/**
 * How long a silence has to be before it is worth filling.
 *
 * Under a second and a half, a pause is a pause. Past it, somebody starts
 * wondering whether the microphone is still on — and this number is deliberately
 * shorter than the three-to-five seconds a local model takes to its first token,
 * because that pause is the one people actually complain about.
 */
export const FIRST_GAP_MS = 1_600;

/**
 * The gap after that, and how it grows.
 *
 * Each filler doubles the wait before the next: 6s, 12s, 24s. A turn that runs
 * two minutes gets four or five remarks, which is about what a person waiting
 * with you would make.
 */
const NEXT_GAP_MS = 6_000;
const GROWTH = 2;

/** After this many, it stops. Past it, nothing said is better than nagging. */
export const MAX_FILLERS = 5;

/** How long the gap should be before the nth filler. */
export const gapBefore = (saidSoFar: number): number =>
  saidSoFar === 0 ? FIRST_GAP_MS : NEXT_GAP_MS * GROWTH ** (saidSoFar - 1);

/**
 * Whether to say something into this silence, and what kind.
 *
 * `null` means stay quiet, which is the answer most of the time.
 */
export const fillerFor = (state: ThinkingState): ThinkingKind | null => {
  // Real speech always wins. A filler over the top of an answer is worse than
  // any silence it could have covered.
  if (state.speaking) return null;
  if (state.saidSoFar >= MAX_FILLERS) return null;
  if (state.quietForMs < gapBefore(state.saidSoFar)) return null;

  // Before anything has happened there is nothing true to report, so it is a
  // sound rather than a sentence.
  if (state.toolsRan === 0) return 'thinking';
  // Past half a minute, "still" — which is the honest word for it and the one
  // that stops somebody wondering whether they have been forgotten.
  return state.elapsedMs > 30_000 ? 'still' : 'working';
};

/**
 * The i18n key for a kind, given how many have already been said.
 *
 * Several lines per kind, cycled, because the same sentence three times is
 * worse than silence — it is what a machine sounds like.
 */
export const VARIANTS_PER_KIND = 3;

export const fillerKey = (kind: ThinkingKind, saidSoFar: number): string =>
  `settings.voice.thinkingAloud.${kind}.${saidSoFar % VARIANTS_PER_KIND}`;
