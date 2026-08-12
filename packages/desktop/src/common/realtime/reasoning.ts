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

/**
 * Whether this turn can be answered without thinking about it.
 *
 * ## Measured again, and the trade is much smaller than it was
 *
 * The numbers above are real and were taken on a cold server. Re-measured
 * against the full task list — nineteen tasks, several of them conversations,
 * timed to the first character of `content` — the same endpoint says something
 * different, and it changes what should be done about it:
 *
 * | | score | first word, median | slowest |
 * | --- | --- | --- | --- |
 * | per sentence, as this ships | **16/17** | 940 ms | 4,941 ms |
 * | deliberate over everything | **16/17** | 942 ms | 4,601 ms |
 * | deliberation off everywhere | 13/17 | **112 ms** | 225 ms |
 *
 * Deliberating costs about **0.8 seconds a turn**, not the four minutes that
 * started this file, and it buys three tasks in seventeen. Switching it off
 * loses the same kinds of turn it always lost — "open YouTube and find it" and
 * "learn this for next time" get answered conversationally with no tool at all —
 * and it loses a multi-turn one too: handed a screenshot and asked which port,
 * the model that did not think answered without reading it.
 *
 * Two things follow, and the second is the one worth writing down.
 *
 * **The policy here is already on the right side of the trade.** Deliberating
 * over everything scores the same and takes the same time; the only turn it
 * makes worse is the greeting, at 975 ms against 238 ms. That difference is the
 * whole of what this function buys, and it is worth having.
 *
 * **Do not widen it.** The obvious next thought — that if thinking is nearly
 * free to skip, more turns should skip it — has the sign backwards. Every turn
 * moved into the fast path is a turn moved from the 16/17 column to the 13/17
 * column, and it saves 0.8 seconds to do it. `speaksOnlyToChat` should stay as
 * narrow as it is.
 *
 * ## Why the trade exists at all
 *
 * Switching the deliberation off made the first spoken word much sooner and
 * cost three of eight tasks: asked to look at the screen, to warm the accent, or
 * to learn a rule for next time, the model answered *conversationally* and
 * reached for no tool at all. Neither end of that is shippable — four minutes is
 * unusable, and an assistant that talks back instead of acting is the opposite
 * of the point.
 *
 * So the choice is made per sentence, and it is deliberately lopsided. The two
 * mistakes are not symmetrical:
 *
 * - deliberating over "merhaba" costs a few seconds of a greeting
 * - **not** deliberating over "ekranıma bak" costs the action entirely
 *
 * One is a slow hello; the other is the product not working. So this does not
 * try to recognise a request to act — that would be a verb list, and the list
 * would be wrong in the direction that breaks things. It recognises the small,
 * closed set of turns that are *only* conversation, and everything else gets
 * the model's full attention.
 *
 * The length guard matters as much as the words: "selam, ekranıma bakar mısın"
 * opens with a greeting and is not one.
 */

/** Past this many characters, a turn is not small talk however it opens. */
export const CHAT_ONLY_MAX_CHARS = 32;

/**
 * The openings that are only ever pleasantries, in the languages this is spoken
 * in. Matched against the whole sentence rather than its start, so "iyi geceler"
 * and "teşekkürler" land wherever they fall in a short turn.
 */
const CHAT_ONLY = [
  // Turkish
  'merhaba',
  'selam',
  'günaydın',
  'gunaydin',
  'iyi akşamlar',
  'iyi aksamlar',
  'iyi geceler',
  'nasılsın',
  'nasilsin',
  'naber',
  'ne haber',
  'teşekkür',
  'tesekkur',
  'sağ ol',
  'sag ol',
  'görüşürüz',
  'gorusuruz',
  'hoşça kal',
  'hosca kal',
  // English
  'hello',
  'good morning',
  'good evening',
  'good night',
  'how are you',
  'thank you',
  'thanks',
  'goodbye',
  'see you',
] as const;

/** Whole words on their own, which longer ones must not match inside. */
const CHAT_ONLY_ALONE = new Set([
  'hi',
  'hey',
  'yo',
  'tamam',
  'evet',
  'hayır',
  'hayir',
  'peki',
  'olur',
  'ok',
  'okay',
  'bye',
]);

export const speaksOnlyToChat = (said: string): boolean => {
  const line = said.trim().toLowerCase();
  if (line.length === 0) return true;
  // A long turn is never small talk, whatever it opens with.
  if (line.length > CHAT_ONLY_MAX_CHARS) return false;

  // The phrases that span words come out first, so "iyi akşamlar" is one
  // pleasantry rather than an unknown "iyi" beside a known "akşamlar".
  let rest = line;
  for (const phrase of CHAT_ONLY.filter((candidate) => candidate.includes(' '))) {
    rest = rest.replaceAll(phrase, ' ');
  }

  const words = rest.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
  if (words.length === 0) return true;

  // *Every* word has to be a pleasantry. Testing the sentence for one instead
  // is what let "selam, ekranıma bakar mısın" through as a greeting — it opens
  // with one and is a request, which is the case this whole rule exists for.
  return words.every(
    (word) =>
      CHAT_ONLY_ALONE.has(word) ||
      // Contained rather than equal, for the languages that glue their endings
      // on: "teşekkürler" and "teşekkür ederim" are the same pleasantry.
      CHAT_ONLY.some((phrase) => !phrase.includes(' ') && word.includes(phrase))
  );
};

/**
 * What to send for this turn: nothing to think about, or room to think.
 *
 * The one place the trade-off is decided, so a caller cannot get half of it.
 */
export const deliberationFor = (said: string, endpoint: string): Record<string, unknown> =>
  speaksOnlyToChat(said) ? noDeliberation(endpoint) : {};
