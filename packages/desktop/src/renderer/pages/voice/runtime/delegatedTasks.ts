/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  fillerKey,
  mayMentionAside,
  shortenForAside,
  VARIANTS_PER_KIND,
  type AsideMoment,
} from '@/common/voice/thinkingAloud';
import type { Translate } from './types';

/**
 * A task the conversation handed over and did not wait for.
 *
 * Until now `app_ask_jester` was awaited inside the tool call, so a spoken turn
 * blocked for as long as the agent ran — minutes, sometimes. Filler lines
 * covered the silence, but covering is all they did: the conversation could not
 * go anywhere else, and asking a second thing while the first was running was
 * impossible.
 *
 * What replaces it is how a person handles the same situation. The task is
 * accepted, the conversation carries on, and when the work finishes the
 * assistant volunteers it — "bu arada, o iş bitti" — into the next gap that can
 * take it.
 *
 * The hard part is not the running. It is the *mentioning*, and there are three
 * ways to get it wrong, all of which this exists to prevent:
 *
 * **Over the answer.** A task that finishes while the assistant is mid-sentence
 * must wait. So must one that finishes while the user is talking.
 *
 * **Over each other.** Two tasks finishing while a third is being discussed is
 * the normal case once delegation is cheap, and two completions read out back
 * to back are one sentence about two unrelated things.
 *
 * **Out of the conversation's reach.** Saying "that thing is done" and then not
 * being able to answer "what did it say?" is worse than never mentioning it.
 * So the result is written into the conversation at the same moment it is
 * spoken, not instead of speaking it.
 */

/** What a delegated task came back with. */
export type DelegatedOutcome = {
  ok: boolean;
  /** The agent's answer, or why there is not one. */
  detail: string;
};

/** One finished task, waiting for a gap it can be mentioned in. */
type Waiting = { what: string; outcome: DelegatedOutcome };

export type DelegatedTasksOptions = {
  t: Translate;
  /**
   * What the conversation is doing, asked fresh every time it matters.
   *
   * Everything the silence contract can be told, rather than the three fields
   * this used to name. The conversation was already supplying the other three —
   * the hush, the off switch, the talk key — and this type dropped them on the
   * floor, so a completion could be announced to somebody who had said "be
   * quiet" or had switched unprompted speech off entirely.
   */
  moment: () => Omit<AsideMoment, 'sinceLastAsideMs'>;
  /** Says one line outside the turn, the way the heartbeat does. */
  speak: (line: string) => void;
  /**
   * Puts the result where the next turn will read it.
   *
   * Separate from `speak` because they answer different questions: one is what
   * the user hears, the other is what the model knows. A user who hears that a
   * task finished will ask what it said, and the answer has to be there.
   */
  note: (line: string) => void;
};

/** How often the queue looks for a gap. Cheap, and a second is not noticeable. */
const LOOK_FOR_A_GAP_MS = 1_000;

/**
 * How much of an agent's answer is written into the conversation.
 *
 * Enough to answer "what did it say?" without spending the whole prompt on a
 * task the user may never ask about again.
 */
const NOTE_MAX = 600;

export class DelegatedTasks {
  private waiting: Waiting[] = [];
  private running = 0;
  private saidSoFar = 0;
  private lastAsideAt = Number.NEGATIVE_INFINITY;
  private timer: number | null = null;
  private closed = false;

  constructor(private readonly options: DelegatedTasksOptions) {}

  /** How many tasks are still out. Shown by the notch, read by the tests. */
  get outstanding(): number {
    return this.running;
  }

  /**
   * Follows a task the conversation is not waiting for.
   *
   * The promise is expected never to reject — everything it can fail at is a
   * reason it reports — but a rejection here would be an unhandled one in a
   * conversation, which is silence, so it is caught anyway.
   */
  follow(what: string, finished: Promise<DelegatedOutcome>): void {
    if (this.closed) return;

    this.running += 1;
    void finished
      .catch(
        (error: unknown): DelegatedOutcome => ({
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        })
      )
      .then((outcome) => {
        this.running -= 1;
        if (this.closed) return;
        this.waiting.push({ what, outcome });
        this.watch();
      });
  }

  /** Stops carrying anything, for a conversation that has ended. */
  close(): void {
    this.closed = true;
    this.waiting = [];
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  /** Starts looking for a gap, if it is not looking already. */
  private watch(): void {
    if (this.timer !== null || this.closed) return;
    this.timer = window.setInterval(() => this.tick(), LOOK_FOR_A_GAP_MS);
  }

  /** One look at the conversation: is there room for the next completion? */
  private tick(): void {
    if (this.closed) return;
    if (this.waiting.length === 0) {
      if (this.timer !== null) window.clearInterval(this.timer);
      this.timer = null;
      return;
    }

    const now = Date.now();
    // Spread rather than destructured: naming the fields here is what lost the
    // hush and the off switch, and it would lose the next field added the same
    // way.
    if (!mayMentionAside({ ...this.options.moment(), sinceLastAsideMs: now - this.lastAsideAt })) return;

    const next = this.waiting.shift();
    if (!next) return;

    this.lastAsideAt = now;
    this.mention(next);
  }

  /** Says one completion, and tells the conversation the same thing. */
  private mention({ what, outcome }: Waiting): void {
    const { t } = this.options;
    const short = shortenForAside(what);

    // Failure gets its own sentence rather than the "is finished" line with a
    // reason bolted on: "by the way, the flight booking is finished" is a lie
    // when it is not, and it is the exact lie the honesty work exists to stop.
    const line = outcome.ok
      ? t(fillerKey('aside', this.saidSoFar), { what: short })
      : t('settings.voice.conversationAsideFailed', { what: short, why: outcome.detail });
    this.saidSoFar = (this.saidSoFar + 1) % VARIANTS_PER_KIND;

    this.options.speak(line);
    this.options.note(
      outcome.ok
        ? `The delegated task "${what}" has finished. What it reported: ${outcome.detail.slice(0, NOTE_MAX) || '(nothing)'}`
        : `The delegated task "${what}" could not be finished: ${outcome.detail.slice(0, NOTE_MAX)}`
    );
  }
}
