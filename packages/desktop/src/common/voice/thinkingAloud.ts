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

/**
 * How long to wait before filling a silence in which nothing is being done.
 *
 * Long, because a turn that has called no tool is not working — it is simply
 * taking a while to answer, and a person does not say "one moment" three times
 * while thinking of a reply to "how are you". Long enough that an ordinary
 * answer arrives first, and short enough that a genuinely stuck turn still says
 * something before the user concludes it has crashed.
 */
export const QUIET_BEFORE_FIRST_WORD_MS = 7_000;

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

  // Nothing has been done yet, so there is nothing to be waiting *for*.
  //
  // This is the rule the first version got wrong, and it was seen: asked
  // "Hello, how are you today?", the assistant answered "One moment. Hmm, let
  // me think. Just a moment." — three of these and no reply. A greeting is not
  // a task, and narrating a wait that nobody is in makes it sound stupid
  // rather than attentive.
  //
  // So before any tool has run this waits far longer and says one thing at
  // most. Once work is genuinely happening the ordinary rhythm applies, which
  // is the case these were written for: minutes of an agent driving a desktop.
  if (state.toolsRan === 0) {
    if (state.saidSoFar >= 1) return null;
    return state.quietForMs >= QUIET_BEFORE_FIRST_WORD_MS ? 'thinking' : null;
  }
  // Past half a minute, "still" — which is the honest word for it and the one
  // that stops somebody wondering whether they have been forgotten.
  return state.elapsedMs > 30_000 ? 'still' : 'working';
};

/**
 * How many lines each kind has to choose from.
 *
 * Five rather than three, and chosen rather than cycled. Three in a fixed
 * rotation is a pattern a person hears by the second conversation — the same
 * three sentences, always in the same order — which is worse than one sentence,
 * because it sounds like a machine pretending not to be one.
 */
export const VARIANTS_PER_KIND = 5;

/**
 * Which line to say, given the one just said.
 *
 * Random, but never the same twice running: at five variants a fair coin
 * repeats often enough to be noticed, and the repeat is the only thing anybody
 * notices. `previous` is `-1` for the first of a conversation.
 */
export const chooseVariant = (previous: number, roll: number = Math.random()): number => {
  const count = VARIANTS_PER_KIND;
  if (previous < 0 || previous >= count) return Math.min(count - 1, Math.floor(roll * count));

  // Pick out of the others, then shift past the one just used, so every
  // remaining line is equally likely and the previous one is impossible.
  const among = Math.min(count - 2, Math.floor(roll * (count - 1)));
  return among >= previous ? among + 1 : among;
};

export const fillerKey = (kind: ThinkingKind, variant: number): string =>
  `settings.voice.thinkingAloud.${kind}.${((variant % VARIANTS_PER_KIND) + VARIANTS_PER_KIND) % VARIANTS_PER_KIND}`;

/**
 * The line for a filler that can name what is actually happening.
 *
 * The module has always claimed it "says what it is doing when it knows", and
 * it never did: `fillerFor` returned a kind and the caller spoke a canned
 * sentence, so a turn that had opened a browser and was typing into it said
 * "still working on it" — true, and indistinguishable from the same words said
 * about nothing. Naming the step is the difference between a progress bar and
 * somebody telling you where they have got to.
 *
 * Its own key rather than a variant of `working`, because the sentence has a
 * hole in it and the others do not.
 */
export const DOING_KEY = 'settings.voice.thinkingAloud.doing';

/**
 * How much of a step's own words survive into a spoken line.
 *
 * A tool reports things like "browser_navigate" and "reading the third result";
 * the first is not worth saying and the second is. Anything longer than this is
 * a sentence of its own and belongs in the activity list, not in a filler.
 */
export const STEP_WORDS_MAX = 48;

/**
 * Whether a step is worth naming out loud.
 *
 * Machine names are not: "browser_navigate" read aloud is worse than "still on
 * it", because it is both ugly and meaningless to the person hearing it.
 */
export const worthSaying = (step: string): boolean => {
  const line = step.trim();
  if (line.length === 0 || line.length > STEP_WORDS_MAX) return false;
  // An identifier rather than a phrase: no spaces and shaped like code.
  if (!line.includes(' ') && /[_.]|[a-z][A-Z]/.test(line)) return false;
  return true;
};

/**
 * How long a gap has to be before a finished task may be mentioned in it.
 *
 * An aside is an interruption — nobody asked for it at the moment it arrives —
 * so it owes the conversation a longer pause than a filler does. A filler is
 * covering a silence the assistant itself created; this is walking into one.
 */
export const QUIET_BEFORE_ASIDE_MS = 2_000;

/**
 * The gap between two asides.
 *
 * Two tasks finishing while a third is being discussed is the case this exists
 * for. Said together they are one long sentence about two unrelated things,
 * which is the moment the user stops listening to either.
 */
export const BETWEEN_ASIDES_MS = 6_000;

/** Whether this moment can carry an interruption. */
export type AsideMoment = {
  /** What the conversation is doing. Only a listening one has room. */
  phase: string;
  /** Told to wait: connected, listening, and not to be spoken to. */
  standby: boolean;
  /** Milliseconds since anything was said, by either side. */
  quietForMs: number;
  /** Milliseconds since the last aside, or `Infinity` when there has been none. */
  sinceLastAsideMs: number;
};

/**
 * Whether a finished task may be volunteered right now.
 *
 * Three ways to be wrong, and all three were worth writing down: over an
 * answer, over the user, and over the previous aside. The first two are what
 * `phase` rules out — `listening` is the only phase in which nobody is talking
 * — and the third is why the last one is timed.
 */
export const mayMentionAside = (moment: AsideMoment): boolean => {
  if (moment.phase !== 'listening' || moment.standby) return false;
  if (moment.quietForMs < QUIET_BEFORE_ASIDE_MS) return false;
  return moment.sinceLastAsideMs >= BETWEEN_ASIDES_MS;
};

/** How much of a request survives into the sentence that mentions it. */
export const ASIDE_NAME_MAX = 60;

/**
 * The request, short enough to sit inside "by the way, … is finished".
 *
 * Spoken rather than shown, which is why this is not a CSS ellipsis: the whole
 * of "open Discord and tell Ali I am running twenty minutes late and will bring
 * the drive" read back at the user is not a reminder, it is the task again.
 */
export const shortenForAside = (request: string, max: number = ASIDE_NAME_MAX): string => {
  const line = request.trim().replaceAll(/\s+/g, ' ');
  if (line.length <= max) return line;

  const cut = line.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // Mid-word is worse than short: a truncated word is heard as a different word.
  const kept = lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(/[\s,;:.]+$/, '')}…`;
};
