/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { getBuiltinSettingsNavItems } from '@renderer/pages/settings/components/SettingsPageWrapper';
import { BUILTIN_TAB_IDS } from '@renderer/pages/settings/components/SettingsSider';

/**
 * The settings page opening at all.
 *
 * The sidebar's order and the sidebar's contents live in two files. Adding a tab
 * to the order and not to the contents put an `undefined` in the list, and the
 * renderer reads `.label` off every item — so one new tab took the whole
 * settings surface down, and the symptom ("settings won't open") said nothing
 * about the cause. It shipped, and it was found by someone trying to open their
 * settings.
 *
 * These are cheap and they are exactly the assertion that was missing.
 */

const t = (key: string, options?: { defaultValue?: string }): string => options?.defaultValue ?? key;

describe('the settings sidebar', () => {
  it('has an entry for every tab it lists, on the desktop', () => {
    const items = getBuiltinSettingsNavItems(true, t);

    expect(items.every((item) => item !== undefined)).toBe(true);
    expect(items.map((item) => item.id)).toEqual([...BUILTIN_TAB_IDS]);
  });

  it('has one in the browser too, where some tabs are hidden but none are broken', () => {
    const items = getBuiltinSettingsNavItems(false, t);

    expect(items.every((item) => item !== undefined)).toBe(true);
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.path.length).toBeGreaterThan(0);
    }
  });

  it('routes each tab to a path of its own, so two never fight over one URL', () => {
    const paths = getBuiltinSettingsNavItems(true, t).map((item) => item.path);

    expect(new Set(paths).size).toBe(paths.length);
  });

  it('offers the memory page, which is where the two documents are read and corrected', () => {
    const items = getBuiltinSettingsNavItems(true, t);

    expect(items.find((item) => item.id === 'memory')?.path).toBe('memory');
  });
});
