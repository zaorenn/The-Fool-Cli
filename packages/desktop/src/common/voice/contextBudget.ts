/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a spoken turn is allowed to cost, counted in tokens rather than messages.
 *
 * The pipeline used to bound the conversation by message count, on the reasoning
 * that speech is short and sixty spoken lines are few tokens. Two things are
 * wrong with that in this app, and together they cost the assistant its mind.
 *
 * The first is that the count ignored everything that is not speech. A tool
 * result lands in the same history a spoken line does, and `app_look_at_screen`
 * returns a description of a screen while `app_search` returns the web. Sixty
 * messages of *those* is not a small number of tokens.
 *
 * The second is that the fixed cost was never counted at all. Before anybody
 * speaks, every request already carries the persona, the tool rules, the app
 * manual and eighteen tool schemas. On a local 9B model — an eight-thousand
 * token window, and the provider row carries no `context_limit` for the app to
 * read — that overhead alone can fill the window.
 *
 * When it overflows, the server truncates from the front, and the front is the
 * system message. So the first thing a too-long conversation loses is every
 * instruction the assistant was given, which is why it stopped calling its
 * tools and started narrating them instead.
 */

/** A message as the spoken pipeline keeps it. */
export type BudgetedMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
};

/**
 * Tokens, near enough to budget with.
 *
 * Deliberately an estimate. A real tokenizer means shipping vocabulary files
 * for models the user chooses at runtime, and the number is wanted for one
 * decision — whether to drop the oldest exchange — where being approximately
 * right in time beats being exactly right too late.
 *
 * 3.6 characters per token is the conservative end of the usual English range
 * and errs toward over-counting, which is the safe direction: over-counting
 * drops one exchange too many, under-counting silently deletes the system
 * prompt. Turkish and other agglutinative languages tokenize worse than
 * English, so the conservative figure is doing real work here rather than
 * padding.
 */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3.6);

/** What the messages cost together. */
export const estimateHistoryTokens = (history: readonly BudgetedMessage[]): number =>
  history.reduce((total, message) => total + estimateTokens(message.content), 0);

/**
 * A ratchet on the unavoidable part of a request — the system prompt and the
 * tool schemas, sent in full on every single turn.
 *
 * **This is a debt marker, not a target.** It was measured at 10,221 tokens and
 * a pass over the tool schemas, removing behaviour directives that the system
 * prompt already states in full, brought it to 9,541. That is a small return,
 * and the reason is worth writing down rather than rediscovering: the remaining
 * mass is enum values and parameter semantics, which cannot be shortened
 * without taking capability away. The duplication that is left lives on the
 * other side — the per-tool paragraphs in `TOOL_RULES` restate what the schemas
 * now carry — and cutting it means editing behaviour that has been tuned over
 * several releases, which is a product decision rather than a cleanup.
 *
 * So the number here exists to stop this growing again, not to claim it is
 * healthy. A fixed cost of nine and a half thousand tokens is defensible
 * against the 64k window the app now reads from the local server, and would not
 * be against the 8k it used to assume.
 */
export const FIXED_OVERHEAD_BUDGET_TOKENS = 9600;

/**
 * The window assumed when the provider does not say.
 *
 * LM Studio and the OpenAI-compatible endpoints it imitates do not report the
 * loaded context length, and the provider record stores `context_limit` only
 * when a user typed one. Assuming small is the safe error: assuming large and
 * being wrong is the overflow this module exists to prevent, while assuming
 * small merely carries less of an old conversation than it could have.
 */
export const DEFAULT_ASSUMED_CONTEXT_TOKENS = 8192;

/**
 * How much of the window is left for the conversation, once the fixed cost and
 * the room the reply needs are taken out.
 */
export const historyBudgetTokens = (
  contextLimit?: number,
  fixedOverheadTokens = FIXED_OVERHEAD_BUDGET_TOKENS
): number => {
  const window = contextLimit && contextLimit > 0 ? contextLimit : DEFAULT_ASSUMED_CONTEXT_TOKENS;
  // A quarter of the window, or a thousand tokens, is kept back for the answer:
  // a request that fits exactly leaves the model nowhere to put its reply.
  const reserved = Math.max(1000, Math.floor(window / 4));
  return Math.max(0, window - fixedOverheadTokens - reserved);
};

/**
 * The conversation, cut to what fits, newest first and system message always.
 *
 * The system message is not a candidate for dropping at any budget. That is the
 * whole point: a conversation that has to forget something should forget the
 * oldest thing said, never the instructions that make it itself. If the budget
 * is too small for even one exchange, the result is the system message alone —
 * an assistant that has lost the thread is recoverable, one that has lost its
 * rules is not.
 */
export const fitHistoryToBudget = (history: readonly BudgetedMessage[], budgetTokens: number): BudgetedMessage[] => {
  if (history.length === 0) return [];

  const [first, ...rest] = history;
  const system = first.role === 'system' ? first : null;
  const candidates = system ? rest : [first, ...rest];

  const systemCost = system ? estimateTokens(system.content) : 0;
  let remaining = budgetTokens - systemCost;

  const kept: BudgetedMessage[] = [];
  // Backwards, because what was just said matters more than what opened the
  // conversation.
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const cost = estimateTokens(candidates[index].content);
    if (cost > remaining) break;
    remaining -= cost;
    kept.unshift(candidates[index]);
  }

  return system ? [system, ...kept] : kept;
};
