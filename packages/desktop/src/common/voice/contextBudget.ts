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
 *
 * **Re-based on 13 Aug 2026, from 9,600 to 12,100.** Four tools arrived on a
 * branch that did not carry this guard — `app_play`, `app_fill_pdf`,
 * `app_connect` and a larger `app_theme` — and the union measured 12,008. The
 * number is raised rather than the tools trimmed, and the reason is a
 * measurement rather than a preference: the spoken pipeline now asks the server
 * what the loaded model can read instead of assuming, and on this machine the
 * answer is 64,256, not 8,192. Against that window 12,008 leaves about 36,000
 * tokens for the conversation. Against the old assumption it left none, which
 * is the state this guard was written to describe.
 *
 * What has not changed is what the marker is for. Twelve thousand tokens on
 * every turn is still a cost somebody should have to justify, and raising this
 * again should mean showing the window it is being justified against.
 *
 * **Re-based again on 15 Aug 2026, from 12,100 to 12,750.** Two tools arrived —
 * `app_research` (451 tokens) and `app_open_document` (187) — and the union
 * measured 12,634, after `app_theme`'s prose was trimmed back by 59 to pay for
 * part of it. What the pair buys is the request this application answered
 * worst: "find me a PDF about X" could previously only be served by opening the
 * user's own browser and driving it, which put a tab in front of somebody who
 * had asked for a document, not for a search. They search, download and open
 * in-app without the user's browser being touched — so deleting them to hold a
 * marker would trade the fix away to preserve the measurement of the fix.
 *
 * Justified against the same window as before: `GET /api/v0/models` reports
 * 64,256 for `qwen/qwen3.5-9b` on this machine, and 12,634 leaves about 51,000
 * tokens for the conversation. That is what the second test in
 * `contextBudget.test.ts` asserts directly, and it is the one that matters —
 * this marker is the ratchet, that one is the requirement.
 */
export const FIXED_OVERHEAD_BUDGET_TOKENS = 12_750;

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
