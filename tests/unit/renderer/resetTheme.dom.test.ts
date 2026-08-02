/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const setConfig = vi.fn().mockResolvedValue(undefined);
const getConfig = vi.fn();
const setActiveInvoke = vi.fn().mockResolvedValue(undefined);

vi.mock('@/common/config/configService', () => ({
  configService: {
    get: (...args: unknown[]) => getConfig(...args),
    set: (...args: unknown[]) => setConfig(...args),
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: { theme: { setActive: { invoke: (...args: unknown[]) => setActiveInvoke(...args) } } },
}));

import { THE_FOOL_THEME_ID } from '@/common/theme/constants';
import { resetThemeToDefault } from '@renderer/utils/theme/resetTheme';

/**
 * The one control that has to work when everything else has stopped working.
 */
describe('resetThemeToDefault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
  });

  it("switches to The Fool's built-in theme rather than reloading the selected one", async () => {
    await resetThemeToDefault();

    expect(setConfig).toHaveBeenCalledWith('theme.activeId', THE_FOOL_THEME_ID);
    expect(setActiveInvoke).toHaveBeenCalledWith(expect.objectContaining({ id: THE_FOOL_THEME_ID }));
  });

  it('clears every colour override', async () => {
    await resetThemeToDefault();

    expect(setConfig).toHaveBeenCalledWith('ui.themeOverrides', { colors: {} });
  });

  /**
   * The stored themes are the one thing a recovery path cannot trust — the
   * broken theme lives there. Reading them at all would put the rescue at the
   * mercy of the wreck.
   */
  it('never reads the user themes', async () => {
    await resetThemeToDefault();

    const readKeys = getConfig.mock.calls.map(([key]) => key);
    expect(readKeys).not.toContain('theme.userThemes');
  });

  it('still repaints when saving fails', async () => {
    setConfig.mockRejectedValueOnce(new Error('storage gone'));

    await expect(resetThemeToDefault()).resolves.toBeUndefined();

    // The document was restyled even though persistence failed, so the user can
    // see the window and try again.
    expect(document.documentElement.getAttribute('data-theme')).toBeTruthy();
  });

  it('leaves the safety net in place afterwards', async () => {
    await resetThemeToDefault();

    expect(document.getElementById('theme-safety-net')?.textContent).toContain('visibility: visible !important');
  });
});
