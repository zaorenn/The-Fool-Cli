/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stopping a local model from thinking for four minutes before it says hello.
 *
 * The first spoken turn took **273 seconds** to its first word. Measured on
 * this machine against `qwen/qwen3.5-9b` with the real persona prompt, and the
 * cause was not what it looked like:
 *
 * | measured | |
 * | --- | --- |
 * | whole prompt, 3,918 tokens, prefilled | **522 ms** |
 * | generation | ~14 tokens a second |
 * | tokens spent before the first spoken word | every one of them |
 *
 * The prompt is not the problem. The model is a reasoning model, and it writes
 * its entire deliberation into `reasoning_content` before it emits a single
 * character of `content` — which the app correctly refuses to read aloud, so
 * from the room it is indistinguishable from a crash.
 *
 * ## Only one switch works, and the rest are silent
 *
 * Ten ways of asking for no deliberation were sent to the running server and
 * the reasoning tokens counted. Exactly one had any effect:
 *
 * | sent | result |
 * | --- | --- |
 * | `reasoning_effort: "none"` | **1,421 ms**, no deliberation, it answers |
 * | `reasoning_effort: "minimal"` / `"low"` | ignored |
 * | `chat_template_kwargs.enable_thinking: false` | ignored |
 * | `/no_think`, `/nothink` in the message | ignored |
 * | `thinking: { type: "disabled" }` | ignored |
 * | `enable_thinking` at the top level | ignored |
 * | telling it so in the system prompt | ignored |
 *
 * On the real request — full persona, all eighteen tool schemas — it is 6,538 ms
 * to the first word without and **177 ms** with, and the model still picks the
 * right tool: `app_look_at_screen` for a question about the screen,
 * `app_open_url` for "open YouTube".
 *
 * ## Why this is a module and not one line
 *
 * An unknown field is *ignored* by this server and **rejected** by some others,
 * and a spoken conversation that 400s is worse than one that thinks too long.
 * So the field is sent, a refusal that names it is caught once, and that
 * endpoint is never asked again for the life of the process.
 */

/**
 * What is added to a spoken request to keep it from deliberating.
 *
 * Spread into the body rather than set, so a caller that has its own opinion
 * about the field can still override it by putting theirs after.
 */
export const NO_DELIBERATION = { reasoning_effort: 'none' } as const;

/** Endpoints that answered a request carrying the field with a refusal. */
const refused = new Set<string>();

/** Whether this endpoint should be asked to skip its deliberation. */
export const mayAskForNoDeliberation = (endpoint: string): boolean => !refused.has(endpoint);

/**
 * What to send for this endpoint: the field, or nothing once it has objected.
 *
 * ```ts
 * body: JSON.stringify({ model, messages, ...noDeliberation(endpoint) })
 * ```
 */
export const noDeliberation = (endpoint: string): Record<string, unknown> =>
  refused.has(endpoint) ? {} : { ...NO_DELIBERATION };

/**
 * Whether a failed response failed *because of* the field.
 *
 * Deliberately narrow. A 400 has many causes and treating all of them as this
 * one would quietly turn the fix off for an endpoint that was refusing
 * something else entirely — and nobody would ever find out, because the symptom
 * is only slowness.
 */
export const refusedTheField = (status: number, body: string): boolean =>
  status === 400 && /reasoning_effort/i.test(body);

/**
 * Remembers that this endpoint will not take it, so the retry is the last one.
 *
 * Per process rather than persisted: an endpoint is usually a local server the
 * user restarts with different settings, and a refusal remembered across
 * launches would outlive the reason for it.
 */
export const rememberRefusal = (endpoint: string): void => {
  refused.add(endpoint);
};

/** For the tests, and for a settings change that should be given a fresh start. */
export const forgetRefusals = (): void => {
  refused.clear();
};
