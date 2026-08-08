/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What one spoken turn actually cost.
 *
 * Every claim this project has made about speed is currently unfalsifiable.
 * Nobody has recorded how many round trips a request takes, how large the
 * prompt has grown, or how long somebody waits before they hear anything — so
 * "fast", "context optimized" and "comfortable on 8 GB" are aspirations with no
 * number behind them, and every optimisation would be a guess.
 *
 * This is the number. It is deliberately the smallest set that can settle an
 * argument:
 *
 *  - **rounds** — how many times the model was asked. Two is a tool call and an
 *    answer. Five means it is circling, and circling is the expensive failure.
 *  - **promptChars** — the prompt is assembled fresh every turn from the
 *    persona, the memory, the skills and the files. It grows silently, and a
 *    small local model slows down in proportion.
 *  - **toFirstAudioMs** — the only latency the user experiences. Total time
 *    matters far less: a reply that starts in 400 ms and runs for eight seconds
 *    feels immediate, and one that arrives whole after three feels broken.
 *  - **totalMs** — for the bill at the end.
 *
 * Characters rather than tokens on purpose: tokenising here would need the
 * model's own tokeniser, which differs per model and is not worth a dependency
 * for a figure being used to spot a trend rather than to bill anybody.
 */

export type TurnMetrics = {
  rounds: number;
  promptChars: number;
  /** Null when the turn produced no speech at all — a refusal, or a pure tool run. */
  toFirstAudioMs: number | null;
  totalMs: number;
  /** How many tools ran, since a turn that did real work is allowed to be slower. */
  toolCalls: number;
};

/** Where a turn's time went, in a form a log line can carry. */
export const describeTurn = (metrics: TurnMetrics): string =>
  [
    `rounds=${metrics.rounds}`,
    `prompt=${metrics.promptChars}c`,
    `firstAudio=${metrics.toFirstAudioMs === null ? 'none' : `${metrics.toFirstAudioMs}ms`}`,
    `total=${metrics.totalMs}ms`,
    `tools=${metrics.toolCalls}`,
  ].join(' ');

/**
 * Whether this turn is worth looking at rather than just recording.
 *
 * Thresholds, not judgements: something over one of these is a turn somebody
 * would have noticed, which is the only useful definition. They are deliberately
 * generous — a warning on every turn is a warning nobody reads.
 */
export const SLOW_FIRST_AUDIO_MS = 4_000;
export const CIRCLING_ROUNDS = 4;
export const LARGE_PROMPT_CHARS = 24_000;

export type TurnConcern = 'slow-first-audio' | 'circling' | 'large-prompt';

export const concernsFor = (metrics: TurnMetrics): TurnConcern[] => {
  const concerns: TurnConcern[] = [];
  if (metrics.toFirstAudioMs !== null && metrics.toFirstAudioMs > SLOW_FIRST_AUDIO_MS) {
    concerns.push('slow-first-audio');
  }
  if (metrics.rounds >= CIRCLING_ROUNDS) concerns.push('circling');
  if (metrics.promptChars > LARGE_PROMPT_CHARS) concerns.push('large-prompt');
  return concerns;
};
