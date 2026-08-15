/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { bestResult, looksLikeFile, parseResults, searchUrl } from '@/common/research/webResults';

/** The shape the results page actually has, trimmed to what the parser reads. */
const page = (
  entries: readonly { href: string; title: string; snippet: string }[]
): string => `<html><body><div class="results">
${entries
  .map(
    (entry) => `
  <div class="result">
    <a rel="nofollow" class="result__a" href="${entry.href}">${entry.title}</a>
    <a class="result__snippet" href="${entry.href}">${entry.snippet}</a>
  </div>`
  )
  .join('\n')}
</div></body></html>`;

describe('searchUrl', () => {
  it('asks for files rather than pages about files when a PDF was wanted', () => {
    const url = searchUrl('diffusion models', 'pdf');

    // Without this the search returns eight web pages *about* PDFs, and
    // whatever is downloaded next is an HTML page saved under a .pdf name.
    expect(decodeURIComponent(url)).toContain('filetype:pdf');
    expect(url.startsWith('https://html.duckduckgo.com/html/?q=')).toBe(true);
  });

  it('covers the office formats when a document was wanted', () => {
    const url = decodeURIComponent(searchUrl('quarterly budget template', 'doc'));
    expect(url).toContain('filetype:docx');
    expect(url).toContain('filetype:xlsx');
  });

  it('adds no filter for an ordinary search', () => {
    expect(decodeURIComponent(searchUrl('who won the match', 'page'))).not.toContain('filetype:');
  });

  it('never opens anything — it only builds an address', () => {
    // The whole point of this module. If a search ever needs a browser again,
    // it needs to be a deliberate change rather than a drift.
    expect(searchUrl('x')).toMatch(/^https:\/\//u);
  });
});

describe('parseResults', () => {
  it('reads the real address out from behind the redirector', () => {
    const html = page([
      {
        href: '//duckduckgo.com/l/?uddg=https%3A%2F%2Farxiv.org%2Fpdf%2F2006.11239.pdf&rut=abc',
        title: 'Denoising Diffusion Probabilistic Models',
        snippet: 'We present high quality image synthesis results...',
      },
    ]);

    expect(parseResults(html)).toEqual([
      {
        title: 'Denoising Diffusion Probabilistic Models',
        url: 'https://arxiv.org/pdf/2006.11239.pdf',
        snippet: 'We present high quality image synthesis results...',
      },
    ]);
  });

  it('keeps an address that is not behind a redirector', () => {
    const html = page([{ href: 'https://example.com/paper.pdf', title: 'A paper', snippet: 'x' }]);
    expect(parseResults(html)[0].url).toBe('https://example.com/paper.pdf');
  });

  it('drops the same address twice rather than offering it twice', () => {
    const html = page([
      { href: 'https://example.com/a.pdf', title: 'One', snippet: 'x' },
      { href: 'https://example.com/a.pdf', title: 'One again', snippet: 'y' },
    ]);
    expect(parseResults(html)).toHaveLength(1);
  });

  it('turns entities back into the characters a person reads', () => {
    const html = page([
      { href: 'https://example.com/a.pdf', title: 'Cats &amp; Dogs &#8212; a study', snippet: 'It&#39;s here' },
    ]);
    const [result] = parseResults(html);
    expect(result.title).toBe('Cats & Dogs — a study');
    expect(result.snippet).toBe("It's here");
  });

  it('returns nothing for a page that is not a page of results', () => {
    // The caller must report this as the parser failing, not as the web being
    // empty — a model told "no results" repeats that to the user as a fact.
    expect(parseResults('<html><body>Are you a robot?</body></html>')).toEqual([]);
  });

  it('keeps at most eight, however many the page carries', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      href: `https://example.com/${index}.pdf`,
      title: `Paper ${index}`,
      snippet: 'x',
    }));
    expect(parseResults(page(many))).toHaveLength(8);
  });
});

describe('bestResult', () => {
  it('prefers the address that actually serves the file', () => {
    // Search engines rank the landing page above the file it links to, so
    // taking the first result downloads an HTML page and calls it a paper.
    const results = [
      { title: 'Abstract page', url: 'https://arxiv.org/abs/2006.11239', snippet: '' },
      { title: 'PDF', url: 'https://arxiv.org/pdf/2006.11239.pdf', snippet: '' },
    ];

    expect(bestResult(results, 'pdf')?.url).toBe('https://arxiv.org/pdf/2006.11239.pdf');
  });

  it('falls back to the first result when none of them is plainly a file', () => {
    const results = [
      { title: 'Landing', url: 'https://example.com/paper', snippet: '' },
      { title: 'Other', url: 'https://example.com/other', snippet: '' },
    ];
    expect(bestResult(results, 'pdf')?.url).toBe('https://example.com/paper');
  });

  it('has nothing to offer when nothing was found', () => {
    expect(bestResult([], 'pdf')).toBeNull();
  });
});

describe('looksLikeFile', () => {
  it('reads the extension past a query string', () => {
    expect(looksLikeFile('https://example.com/a.pdf?download=1', 'pdf')).toBe(true);
    expect(looksLikeFile('https://example.com/a.html', 'pdf')).toBe(false);
  });

  it('accepts anything for an ordinary page search', () => {
    expect(looksLikeFile('https://example.com/anything', 'page')).toBe(true);
  });
});
