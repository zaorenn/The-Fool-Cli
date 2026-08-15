/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Finding something on the web without opening the user's browser.
 *
 * Every route the spoken assistant had to the web went through
 * `shell.openExternal` — `app_search` and `app_open_url` both put a tab in
 * front of the user. So "find me a PDF about X" could only ever be answered by
 * taking over their screen, and the second half of the request, opening the
 * document, had to be done by driving their pointer through it.
 *
 * The pieces to do it properly were all present and unconnected: the agent has
 * a headless search in Rust, the main process already fetches YouTube's results
 * page without a browser for `findVideo`. This is that same technique, made
 * general.
 *
 * Kept pure and separate from the fetch for the reason `videoSearch.ts` is: the
 * parsing is the part that breaks when somebody else changes their markup, and
 * it is the part worth pinning in a test.
 */

/** One thing found, as the assistant will talk about it. */
export type WebResult = {
  title: string;
  url: string;
  /** The result's own summary line, when the page gave one. */
  snippet: string;
};

/** What the user is looking for, which changes how the query is built. */
export type ResearchKind = 'pdf' | 'doc' | 'page';

/**
 * How many results to keep.
 *
 * Enough to choose between, few enough that a search does not fill the context
 * a small local model needs for the rest of the turn.
 */
export const MAX_RESULTS = 8;

/**
 * The filter that narrows a search to files rather than pages.
 *
 * `filetype:` is understood by every engine worth using. Without it, "find me a
 * PDF about diffusion models" returns eight HTML pages *about* PDFs, and the
 * assistant downloads a web page and calls it a paper.
 */
const FILETYPES: Record<ResearchKind, readonly string[]> = {
  pdf: ['pdf'],
  doc: ['docx', 'xlsx', 'pptx', 'doc', 'xls'],
  page: [],
};

/**
 * The address of the results page for a query.
 *
 * DuckDuckGo's HTML endpoint, because it needs no account and no key — this
 * product exists for people who have not bought either.
 */
export const searchUrl = (query: string, kind: ResearchKind = 'page'): string => {
  const types = FILETYPES[kind] ?? [];
  const filter = types.length === 0 ? '' : ` (${types.map((type) => `filetype:${type}`).join(' OR ')})`;
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${query.trim()}${filter}`)}`;
};

/** Turns `&amp;` and friends back into the characters a person would read. */
const decodeEntities = (text: string): string =>
  text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)));

const stripTags = (html: string): string => decodeEntities(html.replaceAll(/<[^>]*>/gu, '')).trim();

/**
 * The real address behind the results page's redirector.
 *
 * The links go through `/l/?uddg=<encoded>`; taking the `href` literally hands
 * the model an address that is not the page it is looking for, which then fails
 * to download for a reason nobody can see.
 */
const realUrl = (href: string): string | null => {
  const marker = href.indexOf('uddg=');
  if (marker === -1) return href.startsWith('http') ? href : null;

  const encoded = href.slice(marker + 'uddg='.length).split('&')[0];
  try {
    const decoded = decodeURIComponent(encoded);
    return decoded.startsWith('http') ? decoded : null;
  } catch {
    return null;
  }
};

/**
 * The results on a page, or an empty list when it is not a page of results.
 *
 * An empty list from here means the markup changed or the search was refused —
 * it does **not** mean the web has nothing. The caller must say so in those
 * words: a model told "no results" repeats it to the user as a fact about the
 * world, and it is instead a fact about this parser.
 */
export const parseResults = (html: string): WebResult[] => {
  const found: WebResult[] = [];
  const seen = new Set<string>();

  // Anchors carrying `result__a` are the titles; the snippet that follows one
  // is in the next `result__snippet`.
  const anchors = html.split('<a ').slice(1);
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    if (!anchor.includes('result__a')) continue;

    const href = /href="([^"]*)"/u.exec(anchor)?.[1];
    if (!href) continue;
    const url = realUrl(decodeEntities(href));
    if (!url || seen.has(url)) continue;

    const title = stripTags(anchor.slice(anchor.indexOf('>') + 1).split('</a>')[0] ?? '');
    if (title.length === 0) continue;

    const after = anchors.slice(index + 1, index + 6).join('<a ');
    const snippetHtml = /result__snippet[^>]*>([\s\S]*?)<\/a>/u.exec(after)?.[1] ?? '';

    seen.add(url);
    found.push({ title, url, snippet: stripTags(snippetHtml).slice(0, 300) });
    if (found.length >= MAX_RESULTS) break;
  }

  return found;
};

/** Whether an address looks like it serves the kind of file that was asked for. */
export const looksLikeFile = (url: string, kind: ResearchKind): boolean => {
  const types = FILETYPES[kind] ?? [];
  if (types.length === 0) return true;

  const path = url.split(/[?#]/u)[0].toLowerCase();
  return types.some((type) => path.endsWith(`.${type}`));
};

/**
 * The result to act on, given what the user asked for.
 *
 * For a file, an address that plainly serves one is preferred over the first
 * result: search engines rank a landing page above the file it links to, and
 * downloading the landing page produces an HTML file with a `.pdf` name.
 * Falls back to the first result, because a preference that finds nothing is
 * worse than a good guess.
 */
export const bestResult = (results: readonly WebResult[], kind: ResearchKind): WebResult | null => {
  if (results.length === 0) return null;
  return results.find((result) => looksLikeFile(result.url, kind)) ?? results[0];
};
