import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const localesRoot = resolve(process.cwd(), 'packages/desktop/src/renderer/services/i18n/locales');

// The names this project was forked from. They are spelled out here rather
// than derived, because the point of the guard is to fail when one of them
// reappears in text a user reads — deriving them from the code that is
// supposed to have stopped producing them would defeat it.
// Assembled from fragments on purpose: a repo-wide rename of the old names is
// exactly the operation that would otherwise rewrite this list into our own
// names and leave the guard passing while checking nothing.
const UPSTREAM = ['A', 'i', 'o', 'n'].join('');
const UPSTREAM_PRODUCT_NAMES = [`${UPSTREAM}Ui`, `${UPSTREAM}Core`, `${UPSTREAM} CLI`, `${UPSTREAM.toLowerCase()}rs`];

describe('The Fool locale branding', () => {
  it('removes upstream product naming from every user-visible locale JSON file', () => {
    const localeDirectories = readdirSync(localesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(localeDirectories.length).toBeGreaterThan(0);

    for (const locale of localeDirectories) {
      const localeDir = resolve(localesRoot, locale.name);
      const jsonFiles = readdirSync(localeDir).filter((name) => name.endsWith('.json'));
      for (const file of jsonFiles) {
        const contents = readFileSync(resolve(localeDir, file), 'utf8');
        for (const name of UPSTREAM_PRODUCT_NAMES) {
          expect(contents, `${locale.name}/${file} still mentions ${name}`).not.toContain(name);
        }
      }
    }
  });
});
