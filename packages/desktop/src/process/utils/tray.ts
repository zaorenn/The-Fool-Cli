/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow, Tray as TrayInstance } from 'electron';
import {
  electronApp as app,
  electronMenu as Menu,
  electronNativeImage as nativeImage,
  electronTray as Tray,
} from '@/common/electronSafe';
import * as path from 'path';
import { ipcBridge } from '@/common';
import { PRODUCT_NAME } from '@/common/brand';
import i18n from '@process/services/i18n';

let tray: TrayInstance | null = null;
/** `undefined` until the user answers the close prompt. See closeToTraySetting. */
let closeToTrayPreference: boolean | undefined;
let isQuitting = false;
let mainWindowRef: BrowserWindow | null = null;
let cachedActiveCount = 0;
/**
 * Whether the wake word currently holds the microphone.
 *
 * Mirrored from the renderer, which owns the setting, so the tray can show the
 * real state rather than a guess. An always-open microphone should be visible and
 * switchable off from outside the app — which is the whole point of it being here
 * rather than three clicks into settings.
 */
let cachedWakeListening = false;

export const setTrayMainWindow = (win: BrowserWindow): void => {
  mainWindowRef = win;
};

export const getCloseToTrayEnabled = (): boolean => closeToTrayPreference === true;

/** `undefined` means the user has not been asked yet. */
export const getCloseToTrayPreference = (): boolean | undefined => closeToTrayPreference;

export const setCloseToTrayEnabled = (enabled: boolean | undefined): void => {
  closeToTrayPreference = enabled;
};

export const getIsQuitting = (): boolean => isQuitting;

export const setIsQuitting = (quitting: boolean): void => {
  isQuitting = quitting;
};

/**
 * Pure decision helper: when tray icon is activated, should we show or hide?
 * Visible + not minimized → hide; otherwise show/focus.
 * Exported for unit tests.
 */
export const shouldShowFromTray = (isVisible: boolean, isMinimized: boolean): boolean => {
  return !isVisible || isMinimized;
};

const showAndFocusMainWindow = (): void => {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
  if (process.platform === 'darwin' && app.dock) {
    void app.dock.show();
  }
  if (mainWindowRef.isMinimized()) {
    mainWindowRef.restore();
  }
  mainWindowRef.show();
  mainWindowRef.focus();
};

const hideMainWindowToTray = (): void => {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
  mainWindowRef.hide();
  if (process.platform === 'darwin' && app.dock) {
    void app.dock.hide();
  }
};

/**
 * Toggle main window visibility from the tray icon (show if hidden/minimized, hide if visible).
 */
export const toggleMainWindowFromTray = (): void => {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
  if (shouldShowFromTray(mainWindowRef.isVisible(), mainWindowRef.isMinimized())) {
    showAndFocusMainWindow();
  } else {
    hideMainWindowToTray();
  }
};

/**
 * Get tray icon.
 * macOS uses Template image to adapt to dark/light menu bar.
 */
const getTrayIcon = (): Electron.NativeImage => {
  const resourcesPath = app.isPackaged ? process.resourcesPath : path.join(process.cwd(), 'resources');
  const icon = nativeImage.createFromPath(path.join(resourcesPath, 'tray.png'));
  if (process.platform === 'darwin') {
    return icon.resize({ width: 16, height: 16 });
  }
  return icon.resize({ width: 32, height: 32 });
};

/**
 * Build tray context menu (async to support dynamic content).
 */
const buildTrayContextMenu = async (): Promise<Electron.Menu> => {
  const getRecentConversations = async (): Promise<Array<{ id: string; title: string }>> => {
    try {
      const result = await ipcBridge.database.getUserConversations.invoke({ limit: 5 });
      return (result.items || []).slice(0, 5).map((conv) => ({
        id: conv.id,
        title: conv.name || i18n.t('common.tray.untitled'),
      }));
    } catch {
      return [];
    }
  };

  const getRunningTasksCount = (): number => cachedActiveCount;

  const recentConversations = await getRecentConversations();
  const runningTasksCount = getRunningTasksCount();

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: i18n.t('common.tray.showWindow'),
      click: showAndFocusMainWindow,
    },
    {
      label: i18n.t('common.tray.closeToTray'),
      click: hideMainWindowToTray,
    },
    { type: 'separator' },
    {
      label: i18n.t('common.tray.newChat'),
      click: () => {
        showAndFocusMainWindow();
        mainWindowRef?.webContents.send('tray:navigate-to-guid');
      },
    },
  ];

  if (recentConversations.length > 0) {
    template.push({ type: 'separator' });
    template.push({
      label: i18n.t('common.tray.recentChats'),
      enabled: false,
    });
    for (const conv of recentConversations) {
      const displayTitle = conv.title.length > 20 ? conv.title.slice(0, 20) + '...' : conv.title;
      template.push({
        label: displayTitle,
        click: () => {
          showAndFocusMainWindow();
          mainWindowRef?.webContents.send('tray:navigate-to-conversation', {
            conversation_id: conv.id,
          });
        },
      });
    }
  }

  template.push({ type: 'separator' });
  template.push({
    label: `${i18n.t('common.tray.runningTasks')}: ${runningTasksCount}`,
    enabled: false,
  });
  template.push({
    label: i18n.t('common.tray.pauseAll'),
    click: () => {
      showAndFocusMainWindow();
      mainWindowRef?.webContents.send('tray:pause-all-tasks');
    },
  });

  template.push({ type: 'separator' });
  template.push({
    label: i18n.t('common.tray.wakeListening'),
    type: 'checkbox',
    checked: cachedWakeListening,
    click: () => {
      // Not shown and focused first: switching the microphone off is exactly the
      // thing you want to do without the app taking over your screen.
      mainWindowRef?.webContents.send('tray:toggle-wake-listening');
    },
  });
  template.push({ type: 'separator' });
  template.push({
    label: i18n.t('common.tray.resetTheme'),
    click: () => {
      // The one menu item that has to work when the window shows nothing at
      // all. A theme that hides the interface takes the settings screen with
      // it, so the way out cannot itself be inside the app — it is here.
      showAndFocusMainWindow();
      mainWindowRef?.webContents.send('tray:reset-theme');
    },
  });

  template.push({ type: 'separator' });
  template.push({
    label: `🐾 ${i18n.t('pet.desktopPet')}`,
    submenu: [
      {
        label: i18n.t('pet.showHide'),
        click: async () => {
          try {
            const petManager = await import('../pet/petManager');
            // Toggle: if pet windows exist, hide; otherwise show/create
            petManager.showPetWindow();
          } catch {
            /* pet not available */
          }
        },
      },
      { type: 'separator' as const },
      {
        label: i18n.t('pet.sizeSmall', { px: 200 }),
        click: async () => {
          try {
            const { resizePetWindow } = await import('../pet/petManager');
            resizePetWindow(200);
          } catch {
            /* ignore */
          }
        },
      },
      {
        label: i18n.t('pet.sizeMedium', { px: 280 }),
        click: async () => {
          try {
            const { resizePetWindow } = await import('../pet/petManager');
            resizePetWindow(280);
          } catch {
            /* ignore */
          }
        },
      },
      {
        label: i18n.t('pet.sizeLarge', { px: 360 }),
        click: async () => {
          try {
            const { resizePetWindow } = await import('../pet/petManager');
            resizePetWindow(360);
          } catch {
            /* ignore */
          }
        },
      },
    ],
  });
  template.push({ type: 'separator' });
  template.push({
    label: i18n.t('common.tray.checkUpdate'),
    click: () => {
      showAndFocusMainWindow();
      mainWindowRef?.webContents.send('tray:check-update');
    },
  });
  template.push({ type: 'separator' });
  template.push({
    label: i18n.t('common.tray.about'),
    click: () => {
      showAndFocusMainWindow();
      mainWindowRef?.webContents.send('tray:open-about');
    },
  });
  template.push({
    label: i18n.t('common.tray.restart'),
    click: () => {
      isQuitting = true;
      app.relaunch();
      app.exit(0);
    },
  });
  template.push({ type: 'separator' });
  template.push({
    label: i18n.t('common.tray.quit'),
    click: () => {
      isQuitting = true;
      app.quit();
    },
  });

  return Menu.buildFromTemplate(template);
};

/**
 * Create system tray (idempotent — no-op if already exists).
 */
export const createOrUpdateTray = (): void => {
  if (tray) {
    return;
  }
  try {
    const icon = getTrayIcon();
    tray = new Tray(icon);
    tray.setToolTip(PRODUCT_NAME);
    void buildTrayContextMenu().then((menu) => tray?.setContextMenu(menu));

    // Double-click: always show/focus (Windows/Linux; macOS rarely fires this).
    tray.on('double-click', () => {
      showAndFocusMainWindow();
    });

    // Left-click: toggle show/hide on Windows & Linux (Discord/Slack pattern).
    // macOS convention is click → context menu only, so skip toggle there.
    tray.on('click', () => {
      if (process.platform === 'darwin') {
        void buildTrayContextMenu().then((menu) => tray?.setContextMenu(menu));
        return;
      }
      toggleMainWindowFromTray();
    });

    void fetchActiveCountAndMaybeRebuild();
  } catch (err) {
    console.error('[Tray] Failed to create tray:', err);
  }
};

/**
 * Rebuild tray menu with current cached state (synchronous wrapper).
 */
const rebuildTrayMenu = (): void => {
  if (!tray) return;
  void buildTrayContextMenu().then((menu) => tray?.setContextMenu(menu));
};

/**
 * Mirrors the renderer's wake-word setting into the tray's checkbox.
 *
 * Rebuilds only on a real change: the menu is torn down and rebuilt each time,
 * and doing that on every settings write would fight with an open menu.
 */
export const setTrayWakeListening = (listening: boolean): void => {
  if (listening === cachedWakeListening) return;
  cachedWakeListening = listening;
  rebuildTrayMenu();
};

/**
 * Ask the renderer to stop always-on listening, from somewhere other than the
 * tray menu — `RightCtrl+V`.
 *
 * Deliberately not shown-and-focused first: switching the microphone off is
 * exactly the thing you want to do without the app taking over your screen,
 * which is the same reasoning as the tray item itself.
 *
 * The channel is a *toggle*, so callers must only reach for this when listening
 * is actually running; sent while it is off it would switch it on.
 */
export const requestWakeListeningOff = (): void => {
  mainWindowRef?.webContents.send('tray:toggle-wake-listening');
};

/**
 * Fetch active count from backend, update cache if changed, and rebuild menu.
 */
const fetchActiveCountAndMaybeRebuild = async (): Promise<void> => {
  try {
    const { count } = await ipcBridge.conversation.activeCount.invoke();
    if (count !== cachedActiveCount) {
      cachedActiveCount = count;
      rebuildTrayMenu();
    }
  } catch {
    // Keep last cached value on error
  }
};

/**
 * Refresh tray context menu labels (called on language change).
 * Immediately rebuilds with current cache, then fetches latest count.
 */
export const refreshTrayMenu = async (): Promise<void> => {
  rebuildTrayMenu();
  await fetchActiveCountAndMaybeRebuild();
};

/**
 * Destroy system tray.
 */
export const destroyTray = (): void => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
};
