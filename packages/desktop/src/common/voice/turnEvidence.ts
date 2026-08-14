/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the turn has actually done, kept in one place.
 *
 * The honesty gates do not ask "did anything run" — that question was tried and
 * is satisfied by the very call that failed. Each asks whether the one thing
 * that could make its sentence true happened, and each needs a different fact
 * kept for it: a screen that came back with a screen in it, a player that
 * reported sound, a launch the system accepted.
 *
 * Those three facts were accumulated separately in both runtimes, with the same
 * three extractor calls copy-pasted into each. That is the shape of a guarantee
 * that quietly holds for one path and not the other: the gate is only as strong
 * as the runtime that remembered to feed it, and nothing fails when one forgets
 * — the user is simply lied to on that path. Adding the launch evidence meant
 * writing the identical two lines in two files, which is what prompted this.
 *
 * The `SpokenTurnEvidence` type is already required rather than optional so a
 * surface that forgets a field is a compile error. This is the other half:
 * there is now one implementation of *deriving* those fields, so a fourth gate
 * is added once.
 */

import { appLaunchOutcome, showedTheScreen, startedPlayback } from './actionClaims';

export type TurnEvidence = {
  /** Fold one finished tool call into what is known. */
  observe(toolName: string, result: unknown): void;
  /**
   * Record a look that did not arrive as a tool result.
   *
   * A capture can happen inside the spoken turn rather than through the tool
   * loop, and the sentence after it has to be licensed by it. Separate from
   * {@link observe} because there is no result to weigh — the caller has
   * already seen the screen.
   */
  markLookedAtScreen(): void;
  /** Whether a screen tool came back with a screen in it. */
  readonly lookedAtScreen: boolean;
  /** Whether a player reported that sound is coming out. */
  readonly startedPlayback: boolean;
  /** Whether a launch was attempted and came back a failure. */
  readonly appLaunchFailed: boolean;
};

/**
 * A fresh accumulator for one conversation.
 *
 * Two of the three are sticky, and deliberately: a screen seen two turns ago
 * was still seen, and a song started two turns ago is still playing, so
 * answering about either is a report rather than a claim. The launch fact is
 * not sticky in the same way — it is overwritten by the next launch outcome,
 * so a failure is forgotten as soon as something opens successfully.
 *
 * What it is *not* is per turn. A launch that failed several turns ago still
 * reads as failed until another is attempted, which is more conservative than
 * the gate needs and is named here rather than left to be discovered: the
 * effect is that a sentence saying something is open can be refused after an
 * unrelated failed launch earlier in the conversation. Narrowing it needs a
 * turn boundary this type does not currently see.
 */
export const createTurnEvidence = (): TurnEvidence => {
  let lookedAtScreen = false;
  let startedPlaybackYet = false;
  let appLaunchFailed = false;

  return {
    observe(toolName: string, result: unknown): void {
      if (showedTheScreen(toolName, result)) lookedAtScreen = true;
      if (startedPlayback(toolName, result)) startedPlaybackYet = true;
      const launch = appLaunchOutcome(toolName, result);
      if (launch !== 'none') appLaunchFailed = launch === 'failed';
    },
    markLookedAtScreen(): void {
      lookedAtScreen = true;
    },
    get lookedAtScreen(): boolean {
      return lookedAtScreen;
    },
    get startedPlayback(): boolean {
      return startedPlaybackYet;
    },
    get appLaunchFailed(): boolean {
      return appLaunchFailed;
    },
  };
};
