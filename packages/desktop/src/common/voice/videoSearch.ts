/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turning a title into an address that actually plays.
 *
 * The assistant can see a song on the screen and read its name, and still have
 * no way to save "play my favourite song": what it needs is the address, and the
 * address bar is usually behind our own window. A search results page is not an
 * answer either — it opens a list, and the user asked for the song.
 *
 * So the title is searched and the first result is resolved to a watch address
 * here, without an API key, and handed back for the user to confirm before
 * anything is saved. Confirmation is the point: this is a guess from a title,
 * and a skill saved from a wrong guess fails much later, out of context, with
 * the user believing they taught it correctly.
 */

export type FoundVideo = {
  /** A canonical watch address — never a search page. */
  url: string;
  /** The result's own title, so the user confirms what was actually found. */
  title: string;
};

/** Ids are exactly eleven characters of an unreserved alphabet. */
const VIDEO_ID = /"videoId":"([\w-]{11})"/;
const TITLE_AFTER_ID = /"videoId":"[\w-]{11}"[\s\S]{0,4000}?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/;

/** JSON string escapes, undone. The payload is JSON embedded in a script tag. */
const unescapeJson = (raw: string): string => {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
};

export const youtubeSearchUrl = (query: string): string =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

export const watchUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`;

/**
 * Read the first playable result out of a YouTube results page.
 *
 * Deliberately narrow: the first `videoId`, and the first title that follows it.
 * Anything less recognisable returns null rather than a guess, because the
 * caller's next step is to offer this to the user as "is this the one?" — and an
 * answer assembled out of the wrong fragment is worse than admitting the search
 * did not resolve.
 */
export const parseFirstVideo = (html: string): FoundVideo | null => {
  const id = VIDEO_ID.exec(html)?.[1];
  if (!id) return null;

  const title = TITLE_AFTER_ID.exec(html)?.[1];
  return { url: watchUrl(id), title: title ? unescapeJson(title) : '' };
};
