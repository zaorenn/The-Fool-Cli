/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DARK_THEME_ID,
  DEFAULT_THEME_ID,
  LIGHT_THEME_ID,
  SYSTEM_THEME_ID,
  THE_FOOL_THEME_ID,
} from '@/common/theme/constants';
import { THEME_COLOR_KEYS, THEME_OVERRIDES_CONFIG_KEY } from '@/common/config/themeOverrides';

const SKILL = readFileSync(
  resolve(__dirname, '../../../backend/core/crates/fool-app/assets/builtin-skills/auto-inject/fool-config/SKILL.md'),
  'utf8'
);

/**
 * The jester could read and write themes all along — `settings client put` works
 * and upserts only the keys it is given. What it could not do was know what to
 * put there: `theme.userThemes` is empty on a fresh install, so the only ids
 * that mean anything are the built-in four, and they appeared nowhere in the
 * skill it is given. Asked to change the theme, it had a key and no values.
 *
 * These tests fail the moment an id is renamed in the code without the skill
 * following, which is the only way a document like this stays true.
 */
describe('the fool-config skill can actually change the appearance', () => {
  it('names every built-in theme id the code defines', () => {
    for (const id of [THE_FOOL_THEME_ID, DARK_THEME_ID, LIGHT_THEME_ID, SYSTEM_THEME_ID]) {
      expect(SKILL).toContain(`\`${id}\``);
    }
  });

  it('names the id the app ships on', () => {
    expect(DEFAULT_THEME_ID).toBe(THE_FOOL_THEME_ID);
    expect(SKILL).toContain(`\`${DEFAULT_THEME_ID}\``);
  });

  // "Make it green" is a colour, not a theme. Without this key the jester's only
  // route to a colour was inventing a whole theme object and switching to it.
  it('documents the colour override key and every colour it accepts', () => {
    expect(SKILL).toContain(THEME_OVERRIDES_CONFIG_KEY);
    for (const key of THEME_COLOR_KEYS) {
      expect(SKILL).toContain(`\`${key}\``);
    }
  });

  /**
   * The skill warns that writing a key "replaces the whole structure". True of a
   * composite value like `fool.voice`, and badly wrong if read as being about
   * the preference map — it would make every theme change look like a
   * read-modify-write of everything the user owns, which is exactly the sort of
   * thing an agent declines to attempt.
   */
  it('says plainly that writing one preference leaves the others alone', () => {
    expect(SKILL).toMatch(/upserts the keys it is given and leaves every other\s+preference alone/);
  });
});
