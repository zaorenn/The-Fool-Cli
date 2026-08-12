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
  /**
   * Told to be quiet for the rest of this session.
   *
   * Optional because the only caller cannot answer it yet — nothing listens for
   * "be quiet" out loud. It is here rather than added later on purpose: the
   * field being absent is a gap somebody can see, and a hush that has to be
   * threaded through afterwards is one that gets threaded through some paths.
   */
  hushed?: boolean;
};

/**
 * Whether a finished task may be volunteered right now.
 *
 * Three ways to be wrong, and all three were worth writing down: over an
 * answer, over the user, and over the previous aside. The first two are what
 * `phase` rules out — `listening` is the only phase in which nobody is talking
 * — and the third is why the last one is timed.
 *
 * Answered through {@link maySpeakUnprompted} rather than beside it. This is the
 * only thing that speaks unasked today, so it is also the only chance to make
 * the contract load-bearing before the second one arrives — and a door that
 * nothing goes through is a door the next reason routes around without anybody
 * noticing. What is left here is the one rule the contract does not have: the
 * gap between two asides, which is about them being *asides* rather than about
 * silence in general.
 */
export const mayMentionAside = (moment: AsideMoment): boolean => {
  if (moment.sinceLastAsideMs < BETWEEN_ASIDES_MS) return false;

  return maySpeakUnprompted({
    // A task the user started themselves. They are waiting for this, which is
    // why it is not rationed by the hour.
    reason: 'task-finished',
    // Deduplication is the caller's here: a delegated task is mentioned once
    // because it finishes once, and `DelegatedTasks` already holds the queue.
    about: '',
    // Neither signal reaches this path yet. Written as the values that change
    // nothing rather than left out, so that wiring them later is an edit at the
    // call site and not a change to the rule.
    enabled: true,
    hushed: moment.hushed === true,
    holdingToTalk: false,
    userIsTyping: false,
    phase: moment.phase,
    standby: moment.standby,
    quietForMs: moment.quietForMs,
    sinceVolunteeredMs: Number.POSITIVE_INFINITY,
    volunteeredInLastHour: 0,
    alreadySaid: NOTHING_SAID_YET,
  }).speak;
};

/** Shared, because an empty set allocated per call is a set allocated per tick. */
const NOTHING_SAID_YET: ReadonlySet<string> = new Set<string>();

/**
 * Being told to be quiet, out loud.
 *
 * The contract has had a `hushed` field since it was written and nothing could
 * ever set it. This is what sets it — and it has to be speech rather than a
 * setting, because the moment somebody wants an assistant to stop talking is not
 * a moment they will spend opening a settings page. An assistant that can only
 * be silenced in Settings gets closed instead.
 *
 * Deliberately narrow, in both directions. "Sus" on its own is the whole of what
 * people say, and it is also a word that turns up inside others — so it is
 * matched as a word, and the phrases around it are the small closed set that
 * cannot mean anything else. What is *not* matched is anything that could be
 * part of a request: "sessiz moda al" is a thing to do to the computer, not a
 * thing to do to the conversation.
 */
const ASKS_FOR_QUIET: readonly RegExp[] = [
  edgedWord('sus|sussana|sus artik|sessiz ol|konusma|kes sesini|rahat birak'),
  edgedWord('bir sey soyleme|artik konusma|simdilik sus'),
  edgedWord('be quiet|shut up|stop talking|no more talking|leave me alone'),
  edgedWord('quiet please|hush'),
];

/** Asking for it back, which has to exist or the hush is a trap. */
const ASKS_TO_RESUME: readonly RegExp[] = [
  edgedWord('konusabilirsin|yine konus|tekrar konus|devam edebilirsin|sesini ac'),
  edgedWord('you can talk|talk again|start talking again|you can speak'),
];

/**
 * Word boundaries that work in the alphabets this is spoken in.
 *
 * The same reason `actionClaims` has its own: `\b` is defined against ASCII and
 * does not fire beside `ş` or `ı`, so `/\bsus\b/` matches nothing useful in the
 * language most of these phrases are said in.
 */
function edgedWord(body: string): RegExp {
  return new RegExp(`(?<!\\p{L})(?:${body})(?!\\p{L})`, 'iu');
}

/** Turkish folded to plain letters, because a transcript drops the diacritics. */
const flatten = (said: string): string =>
  said
    .toLowerCase()
    .replaceAll('ı', 'i')
    .replaceAll('ş', 's')
    .replaceAll('ğ', 'g')
    .replaceAll('ü', 'u')
    .replaceAll('ö', 'o')
    .replaceAll('ç', 'c')
    .replaceAll('İ', 'i');

/** Whether this sentence asks the assistant to stop volunteering things. */
export const asksForQuiet = (said: string): boolean => {
  const line = flatten(said.trim());
  if (line.length === 0) return false;
  if (ASKS_TO_RESUME.some((pattern) => pattern.test(line))) return false;
  return ASKS_FOR_QUIET.some((pattern) => pattern.test(line));
};

/** Whether this sentence asks for it back. */
export const asksToResume = (said: string): boolean => {
  const line = flatten(said.trim());
  return line.length > 0 && ASKS_TO_RESUME.some((pattern) => pattern.test(line));
};

// ───────────────────────────────────────────────────────────────────────────
// Speaking when nobody asked.
//
// Written before anything that speaks unprompted exists, and that order is the
// whole point. Every proactive assistant that has been switched off was
// switched off for the same reason: the rules about when to stay quiet were
// added one at a time, after each complaint, and by then the user had already
// decided. So the rules come first and the reasons come through them — a new
// reason to speak is a new entry in a list, not a new code path with its own
// idea of when it is welcome.
//
// `mayMentionAside` above is the first thing to go through this door; it is
// kept as its own function because a finished task is a different kind of
// remark from the rest, and the difference is written down below.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Why the assistant wants to say something nobody asked for.
 *
 * A closed list, and it is code rather than a line in the persona. A model that
 * can decide for itself when it feels like talking is a model that talks when it
 * feels like it, and there is no setting that fixes that afterwards.
 */
export type UnpromptedReason =
  /** A task it was given has come back. */
  | 'task-finished'
  /** The answer to something it asked earlier has arrived. */
  | 'answer-arrived'
  /** Something it can genuinely see has gone wrong: a build broke, a disk filled. */
  | 'problem-noticed'
  /** Something scheduled is about to happen. */
  | 'schedule-due'
  /** It would like to ask something about the user. */
  | 'curiosity';

/**
 * The two kinds, which is the only distinction that changes the budget.
 *
 * A task the user started themselves and a question they asked are **owed** to
 * them: hearing the outcome is the thing they were waiting for, and rationing it
 * by the hour would mean starting three tasks and being told about one. The rest
 * is genuinely volunteered — nobody asked, nobody is waiting — and that is what
 * a budget is for.
 *
 * Both kinds still pass every silence rule. Owed is not a way through the door;
 * it only means the door is not also rate-limited.
 */
const OWED: ReadonlySet<UnpromptedReason> = new Set<UnpromptedReason>(['task-finished', 'answer-arrived']);

/** At most this many volunteered remarks in an hour. */
export const VOLUNTEERED_PER_HOUR = 1;

export const AN_HOUR_MS = 60 * 60 * 1000;

/** Everything that decides whether speaking now is acceptable. */
export type SilenceContract = {
  /** What this remark is for. */
  reason: UnpromptedReason;
  /**
   * What it is about, in a stable form.
   *
   * Used for one rule and it is the most important one: the same thing is never
   * volunteered twice. Repetition is what turns a helpful assistant into a
   * nagging one faster than anything else, and it is invisible to whoever wrote
   * the feature because they only ever see the first time.
   */
  about: string;

  /** The setting. Off means off, with no exceptions anywhere below. */
  enabled: boolean;
  /**
   * Told to be quiet, for the rest of this session.
   *
   * Separate from the setting because it has to work when said out loud, in the
   * moment, without anybody opening a settings page. An assistant that cannot be
   * hushed by saying "be quiet" is one that gets closed instead.
   */
  hushed: boolean;

  /** What the conversation is doing. Only a listening one has room. */
  phase: string;
  /** Told to wait: connected, listening, and not to be spoken to. */
  standby: boolean;
  /** True while the push-to-talk key is held. They are mid-sentence. */
  holdingToTalk: boolean;
  /** True while the user is typing. They are mid-sentence in another window. */
  userIsTyping: boolean;

  /** Milliseconds since anything was said, by either side. */
  quietForMs: number;
  /** Milliseconds since the last volunteered remark, or `Infinity` if none. */
  sinceVolunteeredMs: number;
  /** How many volunteered remarks were made in the last hour. */
  volunteeredInLastHour: number;
  /** What has already been volunteered, so nothing is said twice. */
  alreadySaid: ReadonlySet<string>;
};

export type SilenceVerdict =
  | { speak: true }
  /** Why not, in words, so a log says which rule held rather than "no". */
  | { speak: false; because: string };

const SPEAK: SilenceVerdict = { speak: true };
const hold = (because: string): SilenceVerdict => ({ speak: false, because });

/**
 * Whether the assistant may say this now.
 *
 * Ordered from the rules that are about the user to the rules that are about the
 * assistant, because that is the order they matter in: being talked over is
 * worse than being told something twice, which is worse than being told
 * something too often.
 */
export const maySpeakUnprompted = (contract: SilenceContract): SilenceVerdict => {
  if (!contract.enabled) return hold('unprompted speech is switched off');
  if (contract.hushed) return hold('asked to be quiet for this session');

  // Mid-sentence, in either direction. The key being held is the clearest
  // signal there is that somebody is about to speak, and typing is the same
  // signal from a different window.
  if (contract.holdingToTalk) return hold('the talk key is held');
  if (contract.userIsTyping) return hold('the user is typing');

  // `listening` is the one phase in which nobody is talking. Anything else is
  // an answer being spoken or a question being heard, and both are worse to
  // interrupt than any remark is worth.
  if (contract.phase !== 'listening') return hold(`the conversation is ${contract.phase}`);
  if (contract.standby) return hold('told to wait');
  if (contract.quietForMs < QUIET_BEFORE_ASIDE_MS) return hold('something was said a moment ago');

  // Never twice about the same thing. Checked before the budget, so a repeat
  // does not even spend one.
  if (contract.alreadySaid.has(contract.about)) return hold('already said this one');

  if (OWED.has(contract.reason)) return SPEAK;

  if (contract.volunteeredInLastHour >= VOLUNTEERED_PER_HOUR) return hold('nothing more unasked this hour');
  if (contract.sinceVolunteeredMs < AN_HOUR_MS) return hold('spoke unasked too recently');

  return SPEAK;
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
