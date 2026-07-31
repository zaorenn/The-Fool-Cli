/**
 * The Jester changes app settings by writing client preferences, and the store
 * accepts any key: a name that does not exist is written happily and silently
 * does nothing. `settings client get` cannot help either — it only returns keys
 * that already hold a value, which on a fresh install is almost none.
 *
 * So the key catalogue in the `fool-config` skill is the only thing standing
 * between the Jester and a guess. These tests keep it honest in both
 * directions: a key the app gains must be documented, and a key the document
 * names must exist.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');

const SKILL_PATH = 'backend/core/crates/fool-app/assets/builtin-skills/auto-inject/fool-config/SKILL.md';
const CONFIG_KEYS_PATH = 'packages/desktop/src/common/config/configKeys.ts';
const CLIENT_SETTINGS_PATH = 'packages/desktop/src/common/config/clientSettings.ts';

const read = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8');

/** The key names of a `export type X = { ... }` map, quoted or bare. */
const typeMapKeys = (source: string, typeName: string): string[] => {
  const start = source.indexOf(`export type ${typeName} = {`);
  if (start === -1) throw new Error(`${typeName} not found`);
  const end = source.indexOf('\n};', start);
  if (end === -1) throw new Error(`${typeName} has no closing brace`);

  const body = source.slice(start, end);
  return [...body.matchAll(/^\s*'?([A-Za-z][\w.]*)'?\??:/gm)].map((match) => match[1]);
};

/**
 * The catalogue itself, without the prose around it.
 *
 * Bounded by the two headings so the examples elsewhere in the document — which
 * name keys in passing — neither satisfy the coverage check nor get audited as
 * if they were catalogue entries.
 */
const catalogue = (): string => {
  const skill = read(SKILL_PATH);
  const start = skill.indexOf('### Appearance');
  const end = skill.indexOf('## Themes', start);
  expect(start, 'catalogue start heading').toBeGreaterThan(-1);
  expect(end, 'catalogue end heading').toBeGreaterThan(start);
  return skill.slice(start, end);
};

/**
 * Dotted names the catalogue presents as real keys.
 *
 * Every config key but a handful carries a dot, and the undotted ones — the
 * colour names, the language tags, the pixel sizes — are exactly what a looser
 * match would drag in. The four bare keys are checked by name instead.
 */
const documentedDottedKeys = (): string[] => [
  ...new Set([...catalogue().matchAll(/`([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)`/g)].map((match) => match[1])),
];

const BARE_KEYS = ['language', 'theme', 'colorScheme', 'customCss'] as const;

describe('fool-config skill key catalogue', () => {
  it('documents every client preference the app can store', () => {
    const appKeys = typeMapKeys(read(CONFIG_KEYS_PATH), 'ConfigKeyMap');
    const businessKeys = typeMapKeys(read(CLIENT_SETTINGS_PATH), 'ClientBusinessSettingMap');
    const documented = new Set([...documentedDottedKeys(), ...BARE_KEYS]);

    expect(appKeys.length).toBeGreaterThan(20);
    const undocumented = [...appKeys, ...businessKeys].filter((key) => !documented.has(key));
    expect(undocumented, 'keys the Jester cannot discover').toEqual([]);
  });

  it('names no key the app does not have', () => {
    const known = new Set([
      ...typeMapKeys(read(CONFIG_KEYS_PATH), 'ConfigKeyMap'),
      ...typeMapKeys(read(CLIENT_SETTINGS_PATH), 'ClientBusinessSettingMap'),
    ]);

    const invented = documentedDottedKeys().filter((key) => !known.has(key));
    expect(invented, 'documented keys that write nowhere').toEqual([]);
  });

  it('sends the Jester to client preferences for the interface language', () => {
    const skill = read(SKILL_PATH);
    const patchSection = skill.slice(skill.indexOf('## Settings'), skill.indexOf('### Appearance'));

    // `settings patch` also takes a `language`, and it is the wrong one: the
    // window reads the client preference. Both accept the write and only one
    // moves, so the document has to say which.
    expect(patchSection).toContain('settings client put');
    expect(patchSection).toMatch(/not what the desktop app reads/i);
  });

  it('warns that the WebUI switch only takes effect on the next launch', () => {
    // `restoreDesktopWebUIFromPreferences` runs at startup and nowhere else, so
    // writing the key never starts the service in the running app.
    expect(catalogue()).toMatch(/read once, when the app starts/i);
  });
});
