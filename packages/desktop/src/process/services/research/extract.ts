/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turning what the web sends back into something a model can be held to.
 *
 * The half with no network in it, and the half worth testing: everything here
 * decides what the assistant will be *allowed to say it read*. The point of the
 * research tool is that an answer about the world is grounded in a page that
 * exists, so the shaping matters more than the fetching — a digest that loses
 * which source said what turns a citation into a decoration.
 */

/** One thing the search engine offered. */
export type SearchResult = {
  title: string;
  url: string;
  /** The engine's own summary. Often enough to answer without opening the page. */
  snippet: string;
};

/** One page that was actually read. */
export type ReadSource = {
  title: string;
  url: string;
  text: string;
};

/** How much of one page is kept. Enough to answer from; bounded so four fit. */
export const MAX_SOURCE_CHARS = 6000;

/** How long a digest may run before it starts pushing the conversation out. */
export const MAX_DIGEST_CHARS = 20_000;

const entities: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
  '#x27': "'",
  '#x2F': '/',
};

/** The handful of entities that actually appear in prose. */
export const decodeEntities = (text: string): string =>
  text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name: string) => {
    const known = entities[name] ?? entities[name.toLowerCase()];
    if (known !== undefined) return known;
    if (name.startsWith('#x') || name.startsWith('#X')) {
      const code = Number.parseInt(name.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (name.startsWith('#')) {
      const code = Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return whole;
  });

/**
 * The elements whose contents are never prose.
 *
 * Removed with their contents rather than unwrapped. A `<script>` unwrapped is
 * a page of JavaScript handed to a model as though somebody had written it to
 * be read, and `<nav>` unwrapped is the site's whole menu repeated in every
 * source — both of which crowd out the paragraph the answer is actually in.
 */
const STRIPPED = /<(script|style|noscript|svg|nav|header|footer|form|aside|iframe)\b[\s\S]*?<\/\1>/gi;

/**
 * A page reduced to the words on it.
 *
 * Deliberately not a readability implementation. Extracting the "article" is a
 * heuristic that fails silently on the pages that are not articles — a
 * changelog, a table of versions, a forum thread — and a silent failure here is
 * an assistant confidently answering from the third of the page it happened to
 * keep. Taking everything and capping it is worse prose and better evidence.
 */
export const htmlToText = (html: string): string =>
  decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(STRIPPED, ' ')
      // Block ends become breaks, so sentences from different paragraphs do not
      // run into each other and read as one claim.
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();

/** The page's own title, which is what a citation should be called. */
export const titleOf = (html: string, fallback: string): string => {
  const found = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const title = found ? decodeEntities(found).replace(/\s+/g, ' ').trim() : '';
  return title.length > 0 ? title.slice(0, 160) : fallback;
};

/**
 * DuckDuckGo's redirector, unwrapped.
 *
 * Its HTML endpoint gives every result as `//duckduckgo.com/l/?uddg=<encoded>`,
 * and handing that to the fetcher would read the redirect page rather than the
 * source — so every citation would be the same address and no source would ever
 * be quoted.
 */
export const unwrapRedirect = (href: string): string => {
  const encoded = /[?&]uddg=([^&]+)/.exec(href)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return href;
    }
  }
  return href.startsWith('//') ? `https:${href}` : href;
};

/** Only what can actually be fetched and read. */
const isReadable = (url: string): boolean => {
  if (!/^https?:\/\//i.test(url)) return false;
  // Binaries are fetched as text and come out as noise; the extension is the
  // only signal available before spending a request on one.
  return !/\.(pdf|zip|exe|dmg|mp4|mp3|png|jpe?g|gif|webp|svg|woff2?)($|\?)/i.test(url);
};

/**
 * The results out of a DuckDuckGo HTML page.
 *
 * Their markup, which is not a contract — so this is written to degrade to an
 * empty list rather than to throw, and the caller treats "nothing found" as an
 * answer. A search that silently returns nothing is recoverable; one that takes
 * the turn down with it is not.
 */
export const parseSearchResults = (html: string, limit: number): SearchResult[] => {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  const anchor = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = [...html.matchAll(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)].map((match) =>
    decodeEntities(match[1].replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim()
  );

  let index = 0;
  for (const match of html.matchAll(anchor)) {
    const url = unwrapRedirect(match[1]);
    const title = decodeEntities(match[2].replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    const snippet = snippets[index] ?? '';
    index += 1;

    if (!isReadable(url) || title.length === 0) continue;
    // The same page offered twice is one source, and reading it twice would
    // make a single site look like corroboration.
    if (seen.has(url)) continue;
    seen.add(url);

    results.push({ title, url, snippet });
    if (results.length >= limit) break;
  }

  return results;
};

/**
 * What the model is given to answer from.
 *
 * Numbered, because the number is what it cites — and every source carries its
 * address, so a claim can be traced back to a page rather than to "the web".
 * The instruction at the top is part of the evidence rather than part of the
 * persona on purpose: it is true of *this* text and nothing else, and a
 * standing rule about honesty is easier for a model to talk itself out of than
 * a sentence attached to the material.
 */
export const buildDigest = (question: string, sources: readonly ReadSource[]): string => {
  if (sources.length === 0) return '';

  const head = [
    `# What was found for: ${question}`,
    '',
    'Answer from these and nothing else. If they do not say, say that they do not — do not fill the gap from memory, because the reason this was fetched is that memory was not good enough. Name the source in words when it matters ("according to the Electron docs"), never by reading its address out loud.',
    '',
  ].join('\n');

  const body = sources
    .map((source, index) => `## [${index + 1}] ${source.title}\n${source.url}\n\n${source.text}`)
    .join('\n\n---\n\n');

  return `${head}${body}`.slice(0, MAX_DIGEST_CHARS);
};

/**
 * A page trimmed to what is worth carrying.
 *
 * The opening is kept rather than a middle slice: pages put what they are about
 * at the top, and a slice from the middle of a long document is the part most
 * likely to be about something else.
 */
export const trimSource = (text: string): string =>
  text.length <= MAX_SOURCE_CHARS ? text : `${text.slice(0, MAX_SOURCE_CHARS).trimEnd()}…`;
