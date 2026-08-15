/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildDigest,
  decodeEntities,
  htmlToText,
  MAX_SOURCE_CHARS,
  parseSearchResults,
  titleOf,
  trimSource,
  unwrapRedirect,
} from '@process/services/research/extract';

/**
 * The half of looking something up that has no network in it.
 *
 * Worth testing because it decides what the assistant will be allowed to say it
 * read. The research tool exists so that an answer about the world is grounded
 * in a page that exists; a digest that loses which source said what turns a
 * citation into a decoration, and a parser that quietly returns nothing turns
 * the whole feature into a no-op nobody notices.
 */

describe('htmlToText', () => {
  it('drops the elements that are never prose, with their contents', () => {
    const html = `
      <html><head><style>.a{color:red}</style></head>
      <body><nav>Home About Contact</nav>
      <script>window.x = 1;</script>
      <p>The capital is Bishkek.</p></body></html>`;

    const text = htmlToText(html);

    expect(text).toContain('The capital is Bishkek.');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('window.x');
    expect(text).not.toContain('About Contact');
  });

  /**
   * Two paragraphs run together read as one claim, which is exactly the kind of
   * thing a model then attributes to a source that did not make it.
   */
  it('keeps separate blocks separate', () => {
    expect(htmlToText('<p>First thing.</p><p>Second thing.</p>')).toBe('First thing.\nSecond thing.');
  });

  it('turns the entities that appear in prose back into characters', () => {
    expect(htmlToText('<p>Tom &amp; Jerry &mdash; &quot;hello&quot;</p>')).toContain('Tom & Jerry');
    expect(decodeEntities('&#39;quoted&#39;')).toBe("'quoted'");
    expect(decodeEntities('&#x27;hex&#x27;')).toBe("'hex'");
  });

  it('leaves an entity it does not know alone rather than mangling it', () => {
    expect(decodeEntities('&notarealentity;')).toBe('&notarealentity;');
  });
});

describe('titleOf', () => {
  it('reads the page’s own title, which is what a citation should be called', () => {
    expect(titleOf('<html><head><title> webUtils | Electron </title></head></html>', 'x')).toBe('webUtils | Electron');
  });

  it('falls back to what the search called it', () => {
    expect(titleOf('<html><body>no title</body></html>', 'The search result')).toBe('The search result');
  });
});

/**
 * DuckDuckGo hands back every result as a link to its own redirector. Reading
 * those would fetch the redirect page instead of the source, so every citation
 * would be the same address and no source would ever really be quoted.
 */
describe('unwrapRedirect', () => {
  it('recovers the real address out of the redirector', () => {
    expect(unwrapRedirect('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&rut=abc')).toBe(
      'https://example.com/docs'
    );
  });

  it('gives a protocol-relative link a protocol', () => {
    expect(unwrapRedirect('//example.com/page')).toBe('https://example.com/page');
  });

  it('leaves an ordinary address alone', () => {
    expect(unwrapRedirect('https://example.com/page')).toBe('https://example.com/page');
  });
});

describe('parseSearchResults', () => {
  const page = `
    <div class="result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone">First <b>result</b></a>
      <a class="result__snippet" href="#">A summary of the first.</a>
    </div>
    <div class="result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ftwo">Second</a>
      <a class="result__snippet" href="#">A summary of the second.</a>
    </div>
    <div class="result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone">First again</a>
      <a class="result__snippet" href="#">The same page.</a>
    </div>`;

  it('reads the title, the real address and the engine’s summary', () => {
    const [first] = parseSearchResults(page, 5);

    expect(first).toEqual({
      title: 'First result',
      url: 'https://example.com/one',
      snippet: 'A summary of the first.',
    });
  });

  /** One page offered twice is one source; reading it twice fakes corroboration. */
  it('takes the same page offered twice as one source', () => {
    expect(parseSearchResults(page, 5).map((result) => result.url)).toEqual([
      'https://example.com/one',
      'https://example.com/two',
    ]);
  });

  it('honours the limit', () => {
    expect(parseSearchResults(page, 1)).toHaveLength(1);
  });

  it('skips what cannot be read as text', () => {
    const binaries = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpaper.pdf">A paper</a>
      <a class="result__a" href="//duckduckgo.com/l/?uddg=ftp%3A%2F%2Fexample.com%2Ffile">Over FTP</a>`;

    expect(parseSearchResults(binaries, 5)).toEqual([]);
  });

  /**
   * Their markup is not a contract. A search that returns nothing is
   * recoverable; one that takes the spoken turn down with it is not.
   */
  it('answers with nothing when the markup is not what it expected', () => {
    expect(parseSearchResults('<html><body>something else entirely</body></html>', 5)).toEqual([]);
    expect(parseSearchResults('', 5)).toEqual([]);
  });
});

describe('buildDigest', () => {
  const sources = [
    { title: 'Bishkek - Wikipedia', url: 'https://en.wikipedia.org/wiki/Bishkek', text: 'Bishkek is the capital.' },
    { title: 'Kyrgyzstan', url: 'https://example.com/kg', text: 'Its capital is Bishkek.' },
  ];

  it('numbers the sources and keeps each one’s address with it', () => {
    const digest = buildDigest('capital of Kyrgyzstan', sources);

    expect(digest).toContain('## [1] Bishkek - Wikipedia');
    expect(digest).toContain('https://en.wikipedia.org/wiki/Bishkek');
    expect(digest).toContain('## [2] Kyrgyzstan');
    expect(digest).toContain('Its capital is Bishkek.');
  });

  /**
   * The instruction travels with the evidence rather than living in the persona.
   * It is true of this text and no other, and a standing rule about honesty is
   * easier for a model to talk itself out of than a sentence attached to the
   * material it is answering from.
   */
  it('tells the model to answer from these and to admit when they do not say', () => {
    const digest = buildDigest('anything', sources);

    expect(digest).toContain('Answer from these and nothing else');
    expect(digest).toContain('do not fill the gap from memory');
  });

  it('is empty when there was nothing to read, so there is nothing to cite', () => {
    expect(buildDigest('anything', [])).toBe('');
  });
});

describe('trimSource', () => {
  it('leaves a page that fits exactly as it was', () => {
    expect(trimSource('short')).toBe('short');
  });

  it('keeps the opening, which is where a page says what it is about', () => {
    const long = `${'a'.repeat(MAX_SOURCE_CHARS)}THE-TAIL`;

    const trimmed = trimSource(long);

    expect(trimmed.length).toBeLessThanOrEqual(MAX_SOURCE_CHARS + 1);
    expect(trimmed).not.toContain('THE-TAIL');
    expect(trimmed.endsWith('…')).toBe(true);
  });
});
