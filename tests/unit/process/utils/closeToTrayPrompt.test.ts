/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  dialog: { showMessageBox: vi.fn() },
}));

vi.mock('@process/services/i18n', () => ({
  default: { t: (key: string) => key },
}));

vi.mock('@process/utils/closeToTraySetting', () => ({
  writeCloseToTraySetting: vi.fn(),
}));

vi.mock('@process/utils/tray', () => ({
  createOrUpdateTray: vi.fn(),
  setCloseToTrayEnabled: vi.fn(),
}));

import type { CloseToTrayPromptDeps } from '@process/utils/closeToTrayPrompt';
import { promptForCloseToTray, resetCloseToTrayPromptForTest } from '@process/utils/closeToTrayPrompt';

const MINIMIZE = 0;
const QUIT = 1;

const makeDeps = (overrides: Partial<CloseToTrayPromptDeps> = {}): CloseToTrayPromptDeps => ({
  showMessageBox: vi
    .fn()
    .mockResolvedValue({ response: MINIMIZE }) as unknown as CloseToTrayPromptDeps['showMessageBox'],
  persist: vi.fn().mockResolvedValue(undefined),
  applyToRuntime: vi.fn(),
  translate: (key: string) => key,
  ...overrides,
});

describe('close-to-tray prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCloseToTrayPromptForTest();
  });

  it('remembers "minimize" so later closes never ask again', async () => {
    const deps = makeDeps();

    await expect(promptForCloseToTray(null, deps)).resolves.toBe(true);

    expect(deps.persist).toHaveBeenCalledWith(true);
    expect(deps.applyToRuntime).toHaveBeenCalledWith(true);
  });

  it('remembers "quit" as the answer rather than leaving it unset', async () => {
    const deps = makeDeps({
      showMessageBox: vi
        .fn()
        .mockResolvedValue({ response: QUIT }) as unknown as CloseToTrayPromptDeps['showMessageBox'],
    });

    await expect(promptForCloseToTray(null, deps)).resolves.toBe(false);

    expect(deps.persist).toHaveBeenCalledWith(false);
  });

  it('keeps the app running when the dialog cannot be shown', async () => {
    const deps = makeDeps({
      showMessageBox: vi
        .fn()
        .mockRejectedValue(new Error('no display')) as unknown as CloseToTrayPromptDeps['showMessageBox'],
    });

    // Quitting on a broken dialog would close the window the user never
    // answered about. Stay open and ask again next time.
    await expect(promptForCloseToTray(null, deps)).resolves.toBe(true);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('still honours the answer when it cannot be written to settings', async () => {
    const deps = makeDeps({ persist: vi.fn().mockRejectedValue(new Error('disk full')) });

    await expect(promptForCloseToTray(null, deps)).resolves.toBe(true);
    expect(deps.applyToRuntime).toHaveBeenCalledWith(true);
  });

  it('shows a single dialog when close is hit twice in a row', async () => {
    let release!: (value: { response: number }) => void;
    const pending = new Promise<{ response: number }>((resolve) => {
      release = resolve;
    });
    const showMessageBox = vi.fn().mockReturnValue(pending);
    const deps = makeDeps({ showMessageBox: showMessageBox as unknown as CloseToTrayPromptDeps['showMessageBox'] });

    const first = promptForCloseToTray(null, deps);
    const second = promptForCloseToTray(null, deps);
    release({ response: MINIMIZE });

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('never makes dismissing the dialog quit the app', async () => {
    const showMessageBox = vi.fn().mockResolvedValue({ response: MINIMIZE });
    const deps = makeDeps({ showMessageBox: showMessageBox as unknown as CloseToTrayPromptDeps['showMessageBox'] });

    await promptForCloseToTray(null, deps);

    // Escape and the window chrome's close both resolve to cancelId.
    const options = showMessageBox.mock.calls[0]?.[0] as Electron.MessageBoxOptions;
    expect(options.cancelId).toBe(MINIMIZE);
    expect(options.buttons?.[MINIMIZE]).toBe('common.tray.closePromptMinimize');
  });
});
