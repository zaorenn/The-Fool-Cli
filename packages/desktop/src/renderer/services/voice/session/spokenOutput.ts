/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  emptyRecallCorrection,
  isEmptyRecall,
  isUnbackedClaim,
  isUnseenScreenClaim,
  isUnverifiedPlaybackClaim,
  unbackedClaimCorrection,
  unseenScreenCorrection,
  unverifiedPlaybackCorrection,
} from '@/common/voice/actionClaims';

/**
 * The one gate every spoken sentence passes before it reaches the speaker.
 *
 * The rule it enforces has existed in the persona for as long as the persona
 * has — 'never say you have done something unless a tool told you it was done',
 * named there as the most damaging thing this assistant can do. It was still
 * watched saying "it's playing now" with an empty activity list, because a model
 * that has decided it finished a task will say so in whatever words the prompt
 * has not forbidden. **A rule cannot answer this; only a mechanism can.**
 *
 * Two things about where this sits matter more than what it checks.
 *
 * **In front of the speaker, not after the reply.** A reply is spoken a
 * sentence at a time while the rest is still being written, so checking the
 * finished text would catch the lie only after the user had heard it.
 *
 * **One place, not one per provider.** Until this existed the guard was imported
 * by a single file — the local pipeline — which meant the guarantee the product
 * is sold on held for one of the four ways a person can talk to it, and for
 * none of the typed ones. Every provider now answers to this function.
 */

/** What the turn has actually done, which is the whole of the other side. */
export type SpokenTurnEvidence = {
  /** How many tools came back this turn. A claim backed by one is a report. */
  toolsRan: number;
  /** How much is in the memory, so a claim to recall can be checked. */
  remembered: number;
  /**
   * Whether a screen has genuinely been seen in this conversation.
   *
   * Required rather than optional, and that is the point of it. Three surfaces
   * ask this gate the same question, and an optional field is one a fourth can
   * forget to answer — which is how the guarantee this application is sold on
   * came to hold for one of the four ways a person can talk to it. A missing
   * answer has to be a compile error.
   *
   * "Seen" means a screen tool came back *with a screen in it*; a capture that
   * failed is not a look. See `showedTheScreen`.
   */
  lookedAtScreen: boolean;
  /**
   * Whether anything has actually reported that sound is coming out.
   *
   * Required for the same reason `lookedAtScreen` is: a fifth surface that
   * forgets to answer must not silently get the permissive answer. `toolsRan`
   * cannot stand in for it — the turn this exists because of ran four tools,
   * none of which could make the sentence true, and the gate waved it through.
   *
   * Per conversation rather than per turn, matching `lookedAtScreen`: a song
   * started two turns ago is still playing now, and "yes, that is the one that
   * is on" is a correct answer rather than a claim. See `startedPlayback`.
   */
  startedPlayback: boolean;
};

export type SpokenSentenceVerdict =
  | { speak: true }
  /** Handed back to the model as its own sentence, for one more round. */
  | { speak: false; correction: string };

const SPEAK: SpokenSentenceVerdict = { speak: true };

/**
 * Whether this sentence may be said out loud.
 *
 * Deliberately per sentence rather than per reply: the speaker is fed a
 * sentence at a time, and a verdict that arrives per reply arrives too late to
 * be a gate at all.
 */
export const guardSpokenSentence = (sentence: string, evidence: SpokenTurnEvidence): SpokenSentenceVerdict => {
  const said = sentence.trim();
  // Nothing said is nothing to refuse. Inventing a correction here would hand
  // the model back an empty string and spend a round on it.
  if (said.length === 0) return SPEAK;

  if (isUnbackedClaim(said, evidence.toolsRan)) {
    return { speak: false, correction: unbackedClaimCorrection(said) };
  }

  if (isEmptyRecall(said, evidence.remembered)) {
    return { speak: false, correction: emptyRecallCorrection(said) };
  }

  // The last two ask a different question from the first two. Those ask whether
  // anything ran; these ask whether the one thing that could have made *this*
  // sentence true ran, and came back with something in it.
  if (isUnseenScreenClaim(said, evidence.lookedAtScreen)) {
    return { speak: false, correction: unseenScreenCorrection(said) };
  }

  // Newest, and the one that had to exist as its own question. "It should now
  // be playing" was said after four tools, so every count-based check was
  // satisfied — and not one of the four was a player.
  if (isUnverifiedPlaybackClaim(said, evidence.startedPlayback)) {
    return { speak: false, correction: unverifiedPlaybackCorrection(said) };
  }

  return SPEAK;
};

/**
 * What a turn still owes the user once the model has stopped writing.
 *
 * The gate above is about not saying false things, and it is only half of
 * honesty. The other half is not leaving something true unsaid — and the turn
 * loop had no opinion about that at all: it ran its rounds, went back to
 * listening, and if the last round produced no text the room simply stayed
 * quiet.
 *
 * Which is what was reported. It opened the song and never said it had. The old
 * behaviour was deliberate — reporting a finished thing costs a round trip and
 * about a second — but a second is not the price of that silence. The price is
 * that the user has no idea whether anything happened, and the only way to find
 * out is to go and look, which is the thing an assistant is for.
 */
export type UnsaidTurn = {
  /** Whether any sentence at all reached the speaker. */
  spokeAnything: boolean;
  /** How many tools finished something this turn. */
  toolsRan: number;
  /**
   * Whether the turn ended by running out of rounds rather than by finishing.
   *
   * The distinction is the difference between a confirmation and a lie. A model
   * that answers every round with another tool call and never says a word has
   * run plenty of tools and completed nothing the user asked for — "Done." there
   * is exactly the small false claim the gate above exists to stop, arriving
   * through the door built to prevent silence.
   */
  ranOutOfRounds: boolean;
};

export type StillOwed =
  /** It spoke. Nothing is owed, whatever else happened. */
  | 'nothing'
  /** Work finished and went unmentioned: say so, briefly. */
  | 'confirmation'
  /** Nothing was done and nothing was said, which is indistinguishable from a crash. */
  | 'admission';

/**
 * Which of the three a finished turn is in.
 *
 * Written here rather than as an `if` in each loop because the two loops had
 * *different* answers: the agent path said "I could not do that" whenever
 * nothing was spoken, which is a lie in the opposite direction when the work
 * succeeded and only the sentence about it went missing; and the local loop
 * said nothing at all in either case.
 */
export const stillOwed = (turn: UnsaidTurn): StillOwed => {
  if (turn.spokeAnything) return 'nothing';
  if (turn.ranOutOfRounds) return 'admission';
  return turn.toolsRan > 0 ? 'confirmation' : 'admission';
};
