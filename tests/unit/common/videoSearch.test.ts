/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseFirstVideo, watchUrl, youtubeSearchUrl } from '@/common/voice/videoSearch';
import { REALTIME_TOOLS } from '@/common/realtime';

/** The shape the results page actually embeds, trimmed to what is read. */
const resultsPage = (id: string, title: string) =>
  `<!doctype html><script>var ytInitialData = {"contents":{"itemSectionRenderer":{"contents":[` +
  `{"videoRenderer":{"videoId":"${id}","thumbnail":{},"title":{"runs":[{"text":"${title}"}]}}}` +
  `]}}};</script>`;

describe('the tools that make a skill teachable', () => {
  const tool = (name: string) => REALTIME_TOOLS.find((candidate) => candidate.name === name);

  it('offers a way to turn a title into an address', () => {
    // Without this the assistant can read a song's name off the screen and
    // still have nothing to save, because the address bar is behind our own
    // window. That is the whole of the failure this fixes.
    expect(tool('app_find_video')?.parameters.required).toEqual(['query']);
  });

  it('still lets the saving tool be called before an address is known', () => {
    // Deliberately not required: the model has the name and the trigger a turn
    // before it has an address. The handler answers that case by naming what is
    // missing — it must not be turned into a schema error, which the model
    // cannot read.
    expect(tool('app_skill_teach')?.parameters.required).toEqual(['name', 'when']);
  });

  it('tells the saving tool to go and find an address rather than invent one', () => {
    expect(tool('app_skill_teach')?.description).toContain('app_find_video');
  });
});

describe('youtubeSearchUrl', () => {
  it('percent-encodes the query rather than pasting it in', () => {
    expect(youtubeSearchUrl('bunny girl & friends')).toBe(
      'https://www.youtube.com/results?search_query=bunny%20girl%20%26%20friends'
    );
  });
});

describe('parseFirstVideo', () => {
  it('resolves the first result to an address that plays, not to a search page', () => {
    const found = parseFirstVideo(resultsPage('dQw4w9WgXcQ', 'Bunny Girl'));

    expect(found).toEqual({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Bunny Girl' });
    expect(found?.url).not.toContain('results?');
  });

  it('unescapes a title so the user is asked about the real name', () => {
    const found = parseFirstVideo(resultsPage('abcdefghijk', 'Bunny Girl \\u0026 Friends \\"live\\"'));

    expect(found?.title).toBe('Bunny Girl & Friends "live"');
  });

  it('takes the first result, not a later one', () => {
    const html = resultsPage('aaaaaaaaaaa', 'First') + resultsPage('bbbbbbbbbbb', 'Second');

    expect(parseFirstVideo(html)?.url).toBe(watchUrl('aaaaaaaaaaa'));
  });

  it('admits it found nothing rather than assembling an address', () => {
    expect(parseFirstVideo('')).toBeNull();
    expect(parseFirstVideo('<html>no results for that</html>')).toBeNull();
    // An id of the wrong length is not an id; guessing one would produce a link
    // that opens a YouTube error page and looks like the skill working.
    expect(parseFirstVideo('{"videoId":"tooshort"}')).toBeNull();
  });

  it('returns the address even when the title cannot be read, so the id is not thrown away', () => {
    const found = parseFirstVideo('{"videoId":"dQw4w9WgXcQ","title":{"simpleText":"different shape"}}');

    expect(found).toEqual({ url: watchUrl('dQw4w9WgXcQ'), title: '' });
  });
});
