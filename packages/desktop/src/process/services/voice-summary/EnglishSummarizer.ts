/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SummaryEndpoint } from './summaryModelResolver';

/**
 * Turns an assistant's reply into the short English briefing that gets spoken.
 *
 * The installed voices are English models. Handed Turkish they produce a mangled
 * accent, and handed a whole reply they read for minutes — so the reply is
 * translated and cut down before it ever reaches the synthesiser. This is the
 * one call that does it, over plain OpenAI chat completions so a local host and a
 * configured provider are the same code path.
 */

export type SummaryFailure = 'unreachable' | 'timeout' | 'empty-output';

export type SummaryOutcome =
  | {
      ok: true;
      text: string;
      /** False when the model shortened the reply but kept its language. */
      translated: boolean;
    }
  | { ok: false; failure: SummaryFailure };

export type SummarizeInput = {
  endpoint: SummaryEndpoint;
  text: string;
  maxCharacters: number;
  timeoutMs: number;
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
};

/** Roughly four characters to a token, with room for a sentence of overshoot. */
const tokenBudget = (maxCharacters: number): number => Math.ceil(maxCharacters / 3) + 64;

/**
 * Least input worth handing to a model.
 *
 * Given an empty passage the prompt reads "Translate into English and
 * summarise:" with nothing after it, and a small local model answers the
 * question it was actually asked — "no context was provided to summarize or
 * translate". That sentence is non-empty, so it passed for a briefing and was
 * read aloud in place of the reply. Nothing this short can be summarised, and
 * asking is what produced the complaint.
 */
const MINIMUM_SUMMARY_CHARACTERS = 12;

export const hasSummarizableText = (text: string): boolean =>
  text.replace(/\s+/g, ' ').trim().length >= MINIMUM_SUMMARY_CHARACTERS;

const buildSystemPrompt = (maxCharacters: number): string =>
  [
    'You are an English-only translator and summariser.',
    'You are given a reply written in any language. You translate it into English and shorten it into a spoken briefing.',
    'Hard rules:',
    '- Your answer contains English words only. Never answer in the language of the input.',
    `- At most ${maxCharacters} characters, two or three sentences.`,
    '- Plain spoken prose: no markdown, no lists, no code, no file paths, no URLs.',
    '- Keep outcomes and numbers exact. If the reply says something failed or is unfinished, say so.',
    '- Add nothing that is not in the reply.',
    'Answer with the English briefing and nothing else.',
  ].join('\n');

const buildUserPrompt = (text: string, insist: boolean): string =>
  insist
    ? // The model already answered in the wrong language once. Saying it again,
      // shorter and last, is what actually moves a small local model.
      `Translate the following into English, then shorten it. Your answer must be in English.\n\n${text}\n\nAnswer in English.`
    : `Translate into English and summarise:\n\n${text}`;

/**
 * Whether a briefing came back in English, as asked.
 *
 * Small local models mirror the language of their input surprisingly often
 * whatever the instruction says — measurably so on qwen3.5-9b. This is the cheap
 * check that catches it: count the words that are not spelled in plain ASCII.
 * One is a borrowed name; a quarter of them is a sentence in another language.
 *
 * It is a heuristic and it knows it. Turkish, Russian, Ukrainian, Persian,
 * Japanese, Chinese and Korean are all caught by their alphabets. A
 * diacritic-free sentence in a Latin-alphabet language would pass — accepting
 * that is cheaper than shipping a language identifier for a check whose only job
 * is to trigger one retry.
 */
export const looksEnglish = (text: string): boolean => {
  const words = text.split(/[\s.,;:!?()"'“”—–/]+/).filter((word) => /\p{L}/u.test(word));
  if (words.length === 0) return false;
  const foreign = words.filter((word) => /[^\x20-\x7E]/.test(word)).length;
  return foreign / words.length <= 0.25;
};

/**
 * Strips a reasoning model's thinking block and any wrapping quotes.
 *
 * Local models routinely emit `<think>…</think>` before the answer; read aloud
 * that is the model's monologue rather than the briefing that was asked for.
 */
export const cleanSummaryOutput = (raw: string): string => {
  const withoutThinking = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    // An unclosed block means the model ran out of budget mid-thought; there is
    // no answer after it, so nothing is lost by dropping the remainder.
    .replace(/<think>[\s\S]*$/i, ' ');

  return withoutThinking
    .replace(/^\s*["'“”]+/, '')
    .replace(/["'“”]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
};

type ChatCompletion = {
  choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
};

/**
 * Room for a reasoning model to finish thinking and still answer.
 *
 * Local chat models are increasingly reasoning models, and their thinking counts
 * against the same token budget as the answer. Given only enough tokens for a
 * briefing they spend all of them deliberating and return an empty message with
 * `finish_reason: "length"` — measurably, on qwen3.5-9b through LM Studio. This
 * is the second, generous attempt for exactly that case.
 */
const REASONING_RETRY_TOKENS = 1536;

type Attempt =
  | { kind: 'text'; text: string }
  /** The model ran out of tokens with nothing said. */
  | { kind: 'truncated' }
  | { kind: 'failure'; failure: SummaryFailure };

type AskOptions = {
  maxTokens: number;
  /**
   * Ask the host not to think, for a one-sentence job that needs no reasoning.
   *
   * Only sent to a local host: `reasoning_effort: "none"` turns a seven-second
   * answer into two there, while a strict remote API may reject a value it does
   * not recognise.
   */
  suppressReasoning: boolean;
  /** Repeat the language requirement, for a model that already ignored it once. */
  insist: boolean;
};

const askOnce = async (input: SummarizeInput, signal: AbortSignal, options: AskOptions): Promise<Attempt> => {
  const doFetch = input.fetchImpl ?? fetch;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (input.endpoint.apiKey) headers.Authorization = `Bearer ${input.endpoint.apiKey}`;

  try {
    const response = await doFetch(`${input.endpoint.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model: input.endpoint.modelId,
        stream: false,
        temperature: 0.2,
        max_tokens: options.maxTokens,
        ...(options.suppressReasoning
          ? { reasoning_effort: 'none', chat_template_kwargs: { enable_thinking: false } }
          : {}),
        messages: [
          { role: 'system', content: buildSystemPrompt(input.maxCharacters) },
          { role: 'user', content: buildUserPrompt(input.text, options.insist) },
        ],
      }),
    });

    if (!response.ok) return { kind: 'failure', failure: 'unreachable' };

    const body = (await response.json()) as ChatCompletion;
    const choice = body.choices?.[0];
    const content = choice?.message?.content;
    const cleaned = typeof content === 'string' ? cleanSummaryOutput(content) : '';
    if (cleaned.length > 0) return { kind: 'text', text: cleaned };
    return choice?.finish_reason === 'length' ? { kind: 'truncated' } : { kind: 'failure', failure: 'empty-output' };
  } catch (error) {
    // A model that is still loading its weights answers late, not wrongly; the
    // caller falls back for this turn and the next one finds it warm.
    const aborted = error instanceof Error && error.name === 'AbortError';
    return { kind: 'failure', failure: aborted ? 'timeout' : 'unreachable' };
  }
};

/**
 * One briefing, in at most two requests.
 *
 * The second request covers the two ways a small local model gets this wrong:
 * spending its whole token budget thinking and saying nothing, and answering in
 * the language of the input. Both share the one deadline, so asking twice cannot
 * double the wait — and a second answer that is still not English is returned
 * anyway, marked as untranslated. A short Turkish summary is a worse answer than
 * an English one and a better answer than the whole reply.
 */
export const summarizeToEnglish = async (input: SummarizeInput): Promise<SummaryOutcome> => {
  // Nothing to summarise: the caller speaks the passage as written rather than
  // the model's complaint about having been handed nothing.
  if (!hasSummarizableText(input.text)) return { ok: false, failure: 'empty-output' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const first = await askOnce(input, controller.signal, {
      maxTokens: tokenBudget(input.maxCharacters),
      suppressReasoning: input.endpoint.local,
      insist: false,
    });
    if (first.kind === 'failure') return { ok: false, failure: first.failure };
    if (first.kind === 'text' && looksEnglish(first.text)) return { ok: true, text: first.text, translated: true };

    const second = await askOnce(input, controller.signal, {
      // Truncation means the model needs room to think; a wrong language means it
      // needs telling again. Neither is harmed by the larger budget.
      maxTokens: REASONING_RETRY_TOKENS,
      suppressReasoning: first.kind === 'text' && input.endpoint.local,
      insist: first.kind === 'text',
    });
    if (second.kind === 'text') return { ok: true, text: second.text, translated: looksEnglish(second.text) };
    if (second.kind === 'failure') return { ok: false, failure: second.failure };
    // The retry was for the language, and it came back empty: the first answer is
    // still the better one to speak.
    if (first.kind === 'text') return { ok: true, text: first.text, translated: false };
    return { ok: false, failure: 'empty-output' };
  } finally {
    clearTimeout(timer);
  }
};
