/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildDigest,
  htmlToText,
  parseSearchResults,
  titleOf,
  trimSource,
  type ReadSource,
  type SearchResult,
} from './extract';

/**
 * Looking something up, rather than remembering it.
 *
 * The assistant could already *open* a search page — `app_search` builds an
 * address and hands it to the browser — and that is the whole of what it could
 * do about the web. It could not read a word of what came back. So every
 * question about something current, or specific, or newer than the model, was
 * answered from weights: confidently, fluently, and with no way for the user to
 * tell which sentences were knowledge and which were the shape of knowledge.
 *
 * This reads. It searches, opens the best few results, and hands the model their
 * text with their addresses attached, so the answer is either grounded in a page
 * that exists or is an admission that the pages did not say. That is the whole
 * design goal: not "better answers", but *checkable* ones.
 *
 * In the main process because a renderer cannot fetch across origins, and
 * keyless because an assistant that needs an API key to stop making things up
 * would stop making things up only for the people who set one up.
 */

/** Chrome's, because a plain Node agent is served a challenge page or nothing. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/**
 * How many results are read in full.
 *
 * Three is the number that changes an answer. One source is a claim; two that
 * agree is a fact; a fourth mostly repeats the first three and costs a second of
 * the user's turn. Measured against the budget rather than guessed: four sources
 * at the per-source cap already exceed what fits beside a conversation.
 */
const SOURCES_READ = 3;

/** How many the search is asked for, so refusals still leave enough to read. */
const RESULTS_WANTED = 8;

/** Long enough for a slow site, short enough not to hold a spoken turn. */
const FETCH_TIMEOUT_MS = 9_000;

/** Nothing sane is bigger, and a stream that never ends is the failure to bound. */
const MAX_BYTES = 3_000_000;

export type ResearchOutcome =
  /**
   * Discriminated on a string rather than on `ok`: `strictNullChecks` is off in
   * this project, so a boolean literal is not a discriminant the compiler
   * follows — see the guards in `pdfForm.ts`.
   */
  | { status: 'found'; digest: string; sources: { title: string; url: string }[] }
  | { status: 'nothing'; query: string }
  | { status: 'failed'; reason: string };

const get = async (url: string, init: RequestInit = {}): Promise<string> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      ...init.headers,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);

  // Only what is text. A binary served without an extension to warn us comes
  // back as replacement characters and would be handed to the model as though
  // somebody had written it.
  const type = response.headers.get('content-type') ?? '';
  if (type.length > 0 && !/text\/html|text\/plain|application\/xhtml/i.test(type)) throw new Error('NOT_TEXT');

  const body = await response.text();
  return body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;
};

/**
 * The results for a question.
 *
 * DuckDuckGo's HTML endpoint, by GET. Measured on a real machine: the GET
 * answers 200 with results, and the POST form this was first written as answers
 * **202 with a challenge page and no results at all** — which parses cleanly to
 * an empty list and would have made the whole feature quietly do nothing.
 *
 * Keyless on purpose. A research tool behind an API key is a research tool most
 * people never have, and the failure it exists to prevent — answering from
 * memory as though from a source — is not one anybody opts into.
 */
export const searchWeb = async (query: string): Promise<SearchResult[]> => {
  const wanted = query.trim();
  if (wanted.length === 0) return [];

  try {
    const html = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(wanted)}`);
    return parseSearchResults(html, RESULTS_WANTED);
  } catch {
    // Nothing found rather than a failure: from where the user sits, a network
    // that will not answer and a web that has nothing are the same sentence.
    return [];
  }
};

/** One page, as text, or nothing when it will not be read. */
export const readWebPage = async (url: string, fallbackTitle: string): Promise<ReadSource | null> => {
  try {
    const html = await get(url);
    const text = htmlToText(html);
    // A page that reduces to a line is a consent wall, a redirect stub or an
    // application shell. Carrying it as a source would make the model cite a
    // page that told it nothing.
    if (text.length < 200) return null;
    return { title: titleOf(html, fallbackTitle), url, text: trimSource(text) };
  } catch {
    return null;
  }
};

/**
 * The whole lookup: search, read, and hand back something citable.
 *
 * The reads happen together rather than in turn. They are independent, they are
 * the slow part, and a spoken conversation is waiting — three pages one after
 * another is three timeouts of latency in the worst case and one in the best.
 *
 * A snippet-only fallback matters more than it looks: when every page refuses to
 * be read — a paywall, a consent wall, a site that blocks anything without a
 * browser — the engine's own summaries are still real text from real pages, and
 * answering from those is honest where answering from memory is not.
 */
export const research = async (question: string): Promise<ResearchOutcome> => {
  const wanted = question.trim();
  if (wanted.length === 0) return { status: 'failed', reason: 'empty-question' };

  const results = await searchWeb(wanted);
  if (results.length === 0) return { status: 'nothing', query: wanted };

  const read = await Promise.all(results.slice(0, SOURCES_READ).map((result) => readWebPage(result.url, result.title)));
  const sources = read.filter((source): source is ReadSource => source !== null);

  if (sources.length === 0) {
    const fromSnippets = results
      .filter((result) => result.snippet.length > 0)
      .map((result) => ({ title: result.title, url: result.url, text: result.snippet }));

    if (fromSnippets.length === 0) return { status: 'nothing', query: wanted };
    return {
      status: 'found',
      digest: buildDigest(wanted, fromSnippets),
      sources: fromSnippets.map(({ title, url }) => ({ title, url })),
    };
  }

  return {
    status: 'found',
    digest: buildDigest(wanted, sources),
    sources: sources.map(({ title, url }) => ({ title, url })),
  };
};
