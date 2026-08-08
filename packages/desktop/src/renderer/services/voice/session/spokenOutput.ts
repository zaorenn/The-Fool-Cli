/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  emptyRecallCorrection,
  isEmptyRecall,
  isUnbackedClaim,
  unbackedClaimCorrection,
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

  return SPEAK;
};
