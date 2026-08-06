/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turning "the key is down" into where an utterance starts and ends.
 *
 * Always-on listening only works if silence is heard as silence, and it is not:
 * the transcriber answers a keystroke or a fan with a confident, well-formed
 * sentence, so an empty room produced a stream of questions nobody had asked.
 * Filtering the invented ones helps and cannot be complete — there is always
 * another sentence a model can invent that is on no list.
 *
 * Holding a key is the only version with no false positives left in it, because
 * the microphone is shut. What is left to decide is bookkeeping: the pipeline
 * wants an utterance opened once, fed while it lasts, and closed once — and the
 * key's state arrives as a fact about every audio block rather than as an edge.
 *
 * Kept here, pure and with no audio in it, for the same reason the desktop hook
 * is: the sequencing is the part that can be wrong, and it is the part worth
 * testing exhaustively.
 */

/** What the pipeline should be told about this block, or nothing at all. */
export type HoldGateVerdict = 'speech-started' | 'speech' | 'utterance-ended' | null;

export type HoldGate = {
  /** The verdict for one audio block, given whether the key is down for it. */
  next: (holding: boolean) => HoldGateVerdict;
};

/**
 * A gate that starts closed.
 *
 * A key already held when a conversation opens does not open an utterance
 * retroactively — the first block seen while it is down does, which is the same
 * moment as far as anything downstream can tell.
 */
export const createHoldGate = (): HoldGate => {
  let open = false;

  return {
    next: (holding: boolean): HoldGateVerdict => {
      if (holding) {
        if (open) return 'speech';
        open = true;
        return 'speech-started';
      }

      if (!open) return null;
      open = false;
      return 'utterance-ended';
    },
  };
};
