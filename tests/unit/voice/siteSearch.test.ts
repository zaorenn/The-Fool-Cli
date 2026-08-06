/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildSiteSearch, findSearchableSite, SEARCHABLE_SITE_IDS } from '@/common/realtime/siteSearch';

/**
 * "Open YouTube and find me that song", as one navigation instead of three
 * minutes of an agent clicking around a browser.
 *
 * The site arrives from a language model, which means it arrives in every form a
 * person might have said it and a few the model invented on top: `YouTube`,
 * `youtube.com`, a whole URL, a country domain. Refusing any of those puts the
 * request back on the slow path over a spelling.
 */

describe('findSearchableSite', () => {
  it('recognises the name however the model wrote it', () => {
    for (const written of ['YouTube', 'youtube', 'you tube', 'yt', 'youtube.com', 'https://www.youtube.com/']) {
      expect(findSearchableSite(written)?.id).toBe('youtube');
    }
  });

  it('recognises a subdomain or a country domain by the name inside it', () => {
    expect(findSearchableSite('music.youtube.com')?.id).toBe('youtube');
    expect(findSearchableSite('amazon.co.uk')?.id).toBe('amazon');
  });

  it('does not claim a site it has no address for', () => {
    expect(findSearchableSite('sahibinden.com')).toBeNull();
    expect(findSearchableSite('   ')).toBeNull();
  });

  /**
   * `x` is one letter, and matching it as a substring would hand every address
   * containing an x to Twitter.
   */
  it('matches a one-letter name as a whole part of the address, not anywhere in it', () => {
    expect(findSearchableSite('x')?.id).toBe('x');
    expect(findSearchableSite('x.com')?.id).toBe('x');
    expect(findSearchableSite('dropbox.com')).toBeNull();
  });
});

describe('buildSiteSearch', () => {
  it('goes straight to the results page for the site that was named', () => {
    expect(buildSiteSearch('youtube', 'bohemian rhapsody')).toEqual({
      site: 'youtube',
      label: 'YouTube',
      url: 'https://www.youtube.com/results?search_query=bohemian+rhapsody',
    });
  });

  it('encodes what would otherwise break the address', () => {
    const search = buildSiteSearch('google', 'c++ & rust?');

    expect(search?.url).toBe('https://www.google.com/search?q=c%2B%2B%20%26%20rust%3F'.replaceAll('%20', '+'));
  });

  /**
   * An unknown site is not a failure — it is what a person does when a site has
   * no search worth using: they search the open web for it.
   */
  it('falls back to the web rather than refusing a site it does not know', () => {
    expect(buildSiteSearch('sahibinden', 'bisiklet')?.site).toBe('google');
    expect(buildSiteSearch('', 'nearest pharmacy')?.site).toBe('google');
  });

  it('refuses an empty query, because opening a bare results page looks like nothing happened', () => {
    expect(buildSiteSearch('youtube', '   ')).toBeNull();
  });

  it('offers every id the tool schema names', () => {
    expect(SEARCHABLE_SITE_IDS).toContain('youtube');
    for (const id of SEARCHABLE_SITE_IDS) expect(buildSiteSearch(id, 'test')?.site).toBe(id);
  });
});
