import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const localesRoot = resolve(process.cwd(), 'packages/desktop/src/renderer/services/i18n/locales');

describe('The Fool locale branding', () => {
  it('removes upstream product naming from every user-visible locale JSON file', () => {
    const localeDirectories = readdirSync(localesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(localeDirectories.length).toBeGreaterThan(0);

    for (const locale of localeDirectories) {
      const localeDir = resolve(localesRoot, locale.name);
      const jsonFiles = readdirSync(localeDir).filter((name) => name.endsWith('.json'));
      for (const file of jsonFiles) {
        const contents = readFileSync(resolve(localeDir, file), 'utf8');
        expect(contents, `${locale.name}/${file}`).not.toContain('AionUi');
      }
    }
  });
});
