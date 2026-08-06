/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Searching inside a site, without driving a browser to do it.
 *
 * "Open YouTube and find me that song" was the request that made this necessary.
 * It used to be handed to the agent whole, because opening a page is one thing
 * and searching within it is another — and the agent did it properly: opened a
 * browser, found the search box, typed, waited. Two to three minutes for a click
 * the user could have done in four seconds, with a spoken conversation sitting
 * there saying "still on it" the entire time.
 *
 * But a site's search results have an address. Every site people name out loud
 * puts the query in the URL, so the whole of "open YouTube and search for X" is
 * one navigation — instant, no agent, nothing to go wrong halfway. That is what
 * this is: the address of the results page, for the sites people actually say.
 *
 * Kept as data rather than as branches so a site is one line to add, and pure so
 * the encoding can be tested without opening anything.
 */

/** One site whose search can be reached by address. */
export type SearchableSite = {
  /** The id the tool takes, and what goes back to the model. */
  id: string;
  /** What to call it out loud. */
  label: string;
  /**
   * The names people say for it.
   *
   * Includes the domain, because a model asked for a site name often sends
   * `youtube.com` or the whole address, and refusing that would put the request
   * back on the slow path for a spelling.
   */
  aliases: readonly string[];
  /** The results page for a query. */
  search: (query: string) => string;
};

const encode = (query: string): string => encodeURIComponent(query.trim()).replaceAll('%20', '+');

/**
 * The sites, most-said first.
 *
 * Deliberately short and deliberately ordinary. This is not meant to be a
 * directory of the web — anything not here still works, it just goes through the
 * agent or through a plain web search, which is the correct answer for a site
 * nobody asks for by name.
 */
export const SEARCHABLE_SITES: readonly SearchableSite[] = [
  {
    id: 'youtube',
    label: 'YouTube',
    aliases: ['youtube', 'you tube', 'yt', 'youtube.com', 'youtu.be', 'utube'],
    search: (query) => `https://www.youtube.com/results?search_query=${encode(query)}`,
  },
  {
    id: 'google',
    label: 'Google',
    aliases: ['google', 'the web', 'web', 'internet', 'google.com'],
    search: (query) => `https://www.google.com/search?q=${encode(query)}`,
  },
  {
    id: 'github',
    label: 'GitHub',
    aliases: ['github', 'git hub', 'github.com'],
    search: (query) => `https://github.com/search?q=${encode(query)}`,
  },
  {
    id: 'wikipedia',
    label: 'Wikipedia',
    aliases: ['wikipedia', 'wiki', 'wikipedia.org'],
    search: (query) => `https://en.wikipedia.org/w/index.php?search=${encode(query)}`,
  },
  {
    id: 'reddit',
    label: 'Reddit',
    aliases: ['reddit', 'reddit.com'],
    search: (query) => `https://www.reddit.com/search/?q=${encode(query)}`,
  },
  {
    id: 'x',
    label: 'X',
    aliases: ['x', 'twitter', 'x.com', 'twitter.com'],
    search: (query) => `https://x.com/search?q=${encode(query)}`,
  },
  {
    id: 'spotify',
    label: 'Spotify',
    aliases: ['spotify', 'spotify.com'],
    search: (query) => `https://open.spotify.com/search/${encodeURIComponent(query.trim())}`,
  },
  {
    id: 'maps',
    label: 'Google Maps',
    aliases: ['maps', 'google maps', 'map', 'maps.google.com'],
    search: (query) => `https://www.google.com/maps/search/${encodeURIComponent(query.trim())}`,
  },
  {
    id: 'amazon',
    label: 'Amazon',
    aliases: ['amazon', 'amazon.com'],
    search: (query) => `https://www.amazon.com/s?k=${encode(query)}`,
  },
  {
    id: 'stackoverflow',
    label: 'Stack Overflow',
    aliases: ['stackoverflow', 'stack overflow', 'stackoverflow.com'],
    search: (query) => `https://stackoverflow.com/search?q=${encode(query)}`,
  },
  {
    id: 'npm',
    label: 'npm',
    aliases: ['npm', 'npmjs', 'npmjs.com'],
    search: (query) => `https://www.npmjs.com/search?q=${encode(query)}`,
  },
  {
    id: 'imdb',
    label: 'IMDb',
    aliases: ['imdb', 'imdb.com'],
    search: (query) => `https://www.imdb.com/find/?q=${encode(query)}`,
  },
];

/** What the search goes to when the site was not named or was not recognised. */
export const DEFAULT_SEARCH_SITE = 'google';

/**
 * Reduces however the site arrived to something comparable.
 *
 * A model sends `YouTube`, `youtube.com`, `https://www.youtube.com/` and
 * `You Tube` for the same request, and every one of them is the user having said
 * one word. Scheme, `www.` and any path are dropped, and what is left is
 * lowercased with its punctuation removed.
 */
const siteKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
    .replaceAll(/[^\p{L}\p{N} .]/gu, '')
    .replaceAll(/\s+/g, ' ')
    .trim();

/** The site the name refers to, or null when it is one we have no address for. */
export const findSearchableSite = (name: string): SearchableSite | null => {
  const key = siteKey(name);
  if (key.length === 0) return null;

  const exact = SEARCHABLE_SITES.find((site) => site.id === key || site.aliases.includes(key));
  if (exact) return exact;

  // A domain that carries a known name inside it — `music.youtube.com`, or a
  // country domain like `amazon.co.uk`. Matched on the alias being a whole
  // dot-separated part, so `x` does not claim every address with an x in it.
  const parts = new Set(key.split(/[. ]/).filter((part) => part.length > 0));
  return SEARCHABLE_SITES.find((site) => site.aliases.some((alias) => parts.has(alias))) ?? null;
};

/** What one search turns into: where to go, and what to call the place. */
export type SiteSearch = { site: string; label: string; url: string };

/**
 * The results page for a query, on the named site.
 *
 * An unknown site is not a failure — it is a search on the open web, which is
 * what a person does when a site has no search of its own worth using. Only an
 * empty query comes back as nothing, because there is no such thing as searching
 * for nothing and opening a bare results page would look like the request being
 * dropped.
 */
export const buildSiteSearch = (site: string, query: string): SiteSearch | null => {
  const wanted = query.trim();
  if (wanted.length === 0) return null;

  const found = findSearchableSite(site) ?? SEARCHABLE_SITES.find((entry) => entry.id === DEFAULT_SEARCH_SITE);
  if (!found) return null;

  return { site: found.id, label: found.label, url: found.search(wanted) };
};

/** The site ids, for the tool schema's enum and for anything listing them. */
export const SEARCHABLE_SITE_IDS: readonly string[] = SEARCHABLE_SITES.map((site) => site.id);
