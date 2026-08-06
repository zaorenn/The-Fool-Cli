/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reading a list of addresses out of whatever the model actually sent.
 *
 * Two problems meet here. The first is safety: `openExternal` hands anything to
 * whatever the system has registered for the scheme, and every character of this
 * argument was written by a language model, so only the two web schemes are let
 * through. The second is that the argument is written by a language model — a
 * small local one will send a bare string where the schema says array, a single
 * string containing several addresses, or the same page twice, and rejecting the
 * call for it means the user watches nothing happen and is told it was done.
 *
 * So the shape is read generously and the contents strictly. Kept pure and
 * separate from the tool handler because this is the part with the interesting
 * failure modes, and the handler is one call to the shell.
 */

/**
 * The most pages one request may open.
 *
 * "Open each of those for me" is a handful of tabs. A model that has just
 * summarised a page of search results can hand back forty, and forty windows
 * arriving at once is indistinguishable from the app malfunctioning.
 */
export const MAX_URLS_PER_CALL = 12;

/** Only the web. Anything else is a scheme the system would hand to some app. */
const WEB_URL = /^https?:\/\/\S+$/i;

/** Splits on the separators a model uses when it puts a list in one string. */
const CANDIDATES = /[\s,;]+/u;

const flatten = (value: unknown): string[] => {
  if (typeof value === 'string') return value.split(CANDIDATES);
  if (Array.isArray(value)) return value.flatMap((entry) => flatten(entry));
  return [];
};

/**
 * The addresses to open, in order, or an empty list when there are none.
 *
 * Duplicates are dropped: a model listing the same mod twice should not cost the
 * user two identical tabs. Order is the model's, because "open them in turn"
 * means the order it just read out.
 */
export const parseOpenUrls = (value: unknown): string[] => {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const candidate of flatten(value)) {
    // Trailing punctuation from a sentence the model wrote around the address.
    const trimmed = candidate.trim().replace(/[.,;)\]]+$/u, '');
    if (!WEB_URL.test(trimmed) || seen.has(trimmed)) continue;

    seen.add(trimmed);
    urls.push(trimmed);
    if (urls.length === MAX_URLS_PER_CALL) break;
  }

  return urls;
};
