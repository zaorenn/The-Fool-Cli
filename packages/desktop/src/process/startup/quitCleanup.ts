/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

type BeforeQuitEvent = {
  preventDefault: () => void;
};

type QuitCleanupDeps = {
  onBeforeQuit: (handler: (event: BeforeQuitEvent) => void) => void;
  quitApp: () => void;
  setIsQuitting: (value: boolean) => void;
  markExplicitQuit: () => void;
  destroyTray: () => void;
  disposeCronResumeListener: () => void;
  stopBackend: () => Promise<void>;
  destroyPetWindow: () => Promise<void> | void;
  /** The agent's offscreen browsing page, if one was ever made. */
  closeAgentPage: () => void;
  logInfo: (message: string) => void;
  logWarn: (message: string) => void;
  logError: (message: string, error: unknown) => void;
  timeoutMs?: number;
};

const DEFAULT_QUIT_CLEANUP_TIMEOUT_MS = 10_000;

async function runWithTimeout(
  work: Promise<void>,
  timeoutMs: number,
  logWarn: (message: string) => void
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      logWarn('[The Fool] Cleanup timed out after 10s, forcing quit');
      resolve();
    }, timeoutMs);
  });

  await Promise.race([work, timeout]);
  if (!timedOut && timeoutId) {
    clearTimeout(timeoutId);
  }
}

async function runQuitCleanup(deps: QuitCleanupDeps): Promise<void> {
  deps.logInfo('[The Fool] before-quit');
  deps.setIsQuitting(true);
  deps.markExplicitQuit();
  deps.destroyTray();

  // Before anything is waited on, and outside the timeout that guards the rest.
  //
  // The pet is two frameless always-on-top windows sitting over everything the
  // user has open, so it is how they can tell whether the quit took. Destroying
  // it used to come after the backend had been stopped and shared that
  // ten-second budget — and a backend that would not stop spent the whole of it,
  // so the pet was never reached: the main window went, the jester stayed, and
  // the app looked like it had ignored the tray menu.
  //
  // Nothing here is worth waiting for. It closes windows this process owns.
  try {
    await deps.destroyPetWindow();
  } catch {
    /* pet not initialized */
  }

  // The same lesson as the pet, and a worse failure. The agent browses in an
  // offscreen window, and a window is a window: `window-all-closed` counts it,
  // so once the agent had looked anything up, closing the main window left the
  // app running with nothing on screen and no way to reach it. Closed here,
  // before anything is waited on, because it is a window this process owns.
  try {
    deps.closeAgentPage();
  } catch {
    /* never opened */
  }

  const cleanup = async () => {
    deps.disposeCronResumeListener();
    await deps.stopBackend().catch((err) => deps.logError('[App] Failed to stop backend:', err));
  };

  await runWithTimeout(cleanup(), deps.timeoutMs ?? DEFAULT_QUIT_CLEANUP_TIMEOUT_MS, deps.logWarn);
}

export function installQuitCleanup(deps: QuitCleanupDeps): void {
  let cleanupStarted = false;
  let cleanupCompleted = false;

  deps.onBeforeQuit((event) => {
    if (cleanupCompleted) {
      return;
    }

    event.preventDefault();
    if (cleanupStarted) {
      return;
    }

    cleanupStarted = true;
    void runQuitCleanup(deps).finally(() => {
      cleanupCompleted = true;
      deps.quitApp();
    });
  });
}
