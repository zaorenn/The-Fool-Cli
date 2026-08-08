/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Something the user said mid-conversation that the next turn has to obey.
 *
 * When the renderer owned the spoken loop, a rule set out loud was written
 * straight into the system prompt and the prompt was rebuilt — so "answer me in
 * English from now on" took effect on the very next sentence. A session owned by
 * the agent runtime builds its system prompt once, at session build, so that
 * trick is gone.
 *
 * Rebuilding the session would throw away the conversation. Waiting until next
 * time would mean agreeing to a rule and then ignoring it, which is the failure
 * the old code existed to prevent and the one the user complains about loudest.
 *
 * So the instruction travels as the head of the next message instead. It reaches
 * the model in the place models read most reliably — the newest turn — it costs
 * one line, and it is honest about when the instruction actually arrived.
 */

/**
 * How many instructions may be waiting at once.
 *
 * Bounded because a turn that never completes would otherwise accumulate them
 * without limit, and a prompt that opens with forty rules is a prompt in which
 * none of them stands out. Ten is far more than a person sets in one breath.
 */
const MAX_PENDING = 10;

/** How the instructions are introduced to the model. */
const PREFACE = 'New instructions, to follow from now on:';

export class PendingInstructions {
  private waiting: string[] = [];

  /** Keeps an instruction for the next turn, if it is new and not empty. */
  add(instruction: string): void {
    const line = instruction.trim();
    if (line.length === 0) return;
    if (this.waiting.some((kept) => kept.toLowerCase() === line.toLowerCase())) return;

    this.waiting.push(line);
    // Oldest first: the most recent instruction is the one the user is watching
    // to see obeyed, so it is the last thing that should be dropped.
    if (this.waiting.length > MAX_PENDING) this.waiting.shift();
  }

  /**
   * Hands over everything waiting, and forgets it.
   *
   * Once rather than every turn: repeating an instruction the model has already
   * been given spends the prompt on things already said, and on a small local
   * model the newest line is the loudest one.
   */
  takeForNextTurn(): string[] {
    const taken = this.waiting;
    this.waiting = [];
    return taken;
  }

  /** Whether anything is owed to the next turn. */
  get pending(): number {
    return this.waiting.length;
  }

  /** Drops everything, for a conversation that has ended. */
  clear(): void {
    this.waiting = [];
  }
}

/**
 * What the user said, with any new instructions ahead of it.
 *
 * Ahead rather than behind, and labelled, so the model reads them as standing
 * instructions rather than as part of the question.
 */
export const prefaceWithInstructions = (said: string, instructions: readonly string[]): string => {
  if (instructions.length === 0) return said;

  const lines = instructions.map((instruction) => `- ${instruction}`).join('\n');
  return `${PREFACE}\n${lines}\n\n${said}`;
};
