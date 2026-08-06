/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one line a finished conversation leaves behind.
 *
 * Only the local pipeline used to write one, because only it has a model sitting
 * on the same machine that can be asked for a summary for free. So a
 * conversation held over OpenAI Realtime or Gemini Live — the two providers
 * someone paying for this would actually use — was forgotten completely the
 * moment it ended. "Yesterday you were stuck on the installer" worked on the
 * free path and nowhere else, which is the wrong way round.
 *
 * A summary written by a model is better than this and should be preferred where
 * one is available. This is what to write when it is not: the first thing they
 * asked and the last, which between them say what a conversation was about far
 * better than nothing does, and cost no tokens and no round trip at a moment
 * when the user is already walking away.
 */

import { memoryLine, MAX_MEMORY_LINE } from './memoryDoc';

/** One thing that was said, by whichever side said it. */
export type SpokenTurn = { role: 'user' | 'assistant'; text: string };

/**
 * How many things the user has to have said before it counts as a conversation.
 *
 * One exchange is a question. Remembering "what time is it" as a session would
 * fill the memory with things nobody will ever want recalled.
 */
export const MIN_TURNS_WORTH_REMEMBERING = 2;

/** Everything the user actually said, blank turns dropped. */
const asked = (turns: readonly SpokenTurn[]): string[] =>
  turns
    .filter((turn) => turn.role === 'user')
    .flatMap((turn) => (turn.text.trim().length > 0 ? [turn.text.trim()] : []));

/** Whether this was enough of a conversation to be worth a line in the memory. */
export const worthRemembering = (turns: readonly SpokenTurn[]): boolean =>
  asked(turns).length >= MIN_TURNS_WORTH_REMEMBERING;

/**
 * What was talked about, in the user's own words rather than in a model's.
 *
 * The first and the last thing they asked, which is the shape a person uses
 * when they describe a conversation from memory: where it started and where it
 * ended up. Identical or near-identical ends collapse to one, because a
 * conversation with a single subject should read as having had one.
 */
export const describeSpokenTurns = (turns: readonly SpokenTurn[]): string => {
  const questions = asked(turns);
  if (questions.length === 0) return '';

  const first = questions[0];
  const last = questions.at(-1) ?? first;
  if (questions.length === 1 || first === last) return memoryLine(first);

  // Half each, so a long opening question cannot crowd the closing one out.
  const half = Math.floor((MAX_MEMORY_LINE - 3) / 2);
  return memoryLine(`${first.slice(0, half)} … ${last.slice(0, half)}`);
};
