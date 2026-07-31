/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { dialog } from 'electron';
import i18n from '@process/services/i18n';
import { writeCloseToTraySetting } from './closeToTraySetting';
import { createOrUpdateTray, setCloseToTrayEnabled } from './tray';

/**
 * Index of the "minimize to tray" button in the prompt.
 *
 * On Windows the buttons render left to right in array order, and the OS reads
 * `cancelId` as the Escape/close action — so quitting must never be the cancel
 * button, or dismissing the dialog would quit the app.
 */
const MINIMIZE_BUTTON_INDEX = 0;

/** Guards against a second prompt while one is already on screen. */
let promptInFlight: Promise<boolean> | null = null;

export type CloseToTrayPromptDeps = {
  showMessageBox: typeof dialog.showMessageBox;
  persist: (enabled: boolean) => Promise<void>;
  applyToRuntime: (enabled: boolean) => void;
  translate: (key: string) => string;
};

const defaultDeps = (): CloseToTrayPromptDeps => ({
  showMessageBox: dialog.showMessageBox.bind(dialog),
  persist: writeCloseToTraySetting,
  applyToRuntime: (enabled) => {
    setCloseToTrayEnabled(enabled);
    if (enabled) createOrUpdateTray();
  },
  translate: (key) => i18n.t(key),
});

/**
 * Ask once what the close button should do, remember the answer, and apply it.
 *
 * Resolves to the chosen behaviour: `true` keeps the app running in the tray,
 * `false` means quit. The answer is written to settings so every later close —
 * and every later launch — follows it without asking again; the user can still
 * change it under Settings → System.
 */
export const promptForCloseToTray = async (
  window: BrowserWindow | null,
  deps: CloseToTrayPromptDeps = defaultDeps()
): Promise<boolean> => {
  if (promptInFlight) return promptInFlight;

  const run = async (): Promise<boolean> => {
    const t = deps.translate;
    let minimize = false;
    try {
      const options: Electron.MessageBoxOptions = {
        type: 'question',
        title: t('common.tray.closePromptTitle'),
        message: t('common.tray.closePromptMessage'),
        detail: t('common.tray.closePromptDetail'),
        buttons: [t('common.tray.closePromptMinimize'), t('common.tray.closePromptQuit')],
        defaultId: MINIMIZE_BUTTON_INDEX,
        cancelId: MINIMIZE_BUTTON_INDEX,
        noLink: true,
      };
      const { response } =
        window && !window.isDestroyed()
          ? await deps.showMessageBox(window, options)
          : await deps.showMessageBox(options);
      minimize = response === MINIMIZE_BUTTON_INDEX;
    } catch {
      // A dialog that cannot be shown must not take the window down with it:
      // fall back to the safer half of the choice and ask again next time.
      return true;
    }

    deps.applyToRuntime(minimize);
    // Persistence is best-effort — a failed write costs one repeated prompt,
    // which is far cheaper than refusing to honour the answer just given.
    await deps.persist(minimize).catch(() => {});
    return minimize;
  };

  promptInFlight = run().finally(() => {
    promptInFlight = null;
  });
  return promptInFlight;
};

/** Test seam: drops any in-flight prompt so cases start from a clean state. */
export const resetCloseToTrayPromptForTest = (): void => {
  promptInFlight = null;
};
