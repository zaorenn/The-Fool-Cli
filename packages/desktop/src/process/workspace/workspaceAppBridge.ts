/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcMain } from 'electron';

/**
 * How the renderer asks for a workspace's app to be served, written or read.
 *
 * Thin, like the preview bridge next to it. Everything with a path in it is
 * confined by the server module rather than here, so there is one place that
 * decides what "inside the workspace apps folder" means and no handler can
 * disagree with it.
 *
 * The server module is imported inside the handlers rather than at the top: the
 * bridges are wired before Electron is ready, and it reaches for the user data
 * directory at module scope.
 */

let registered = false;

export function initWorkspaceAppBridge(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle('workspace-app:serve', async (_event, folder: unknown, entry: unknown) => {
    if (typeof folder !== 'string' || typeof entry !== 'string') return { ok: false, reason: 'not-a-folder' };
    const { serveWorkspaceApp } = await import('./workspaceAppServer');
    return serveWorkspaceApp(folder, entry);
  });

  ipcMain.handle('workspace-app:stop', async (): Promise<void> => {
    const { stopWorkspaceApp } = await import('./workspaceAppServer');
    await stopWorkspaceApp();
  });

  ipcMain.handle('workspace-app:prepare', async (_event, folder: unknown): Promise<string> => {
    if (typeof folder !== 'string') throw new Error('WORKSPACE_APP_BAD_FOLDER');
    const { prepareWorkspaceApp } = await import('./workspaceAppServer');
    return prepareWorkspaceApp(folder);
  });

  ipcMain.handle('workspace-app:read', async (_event, folder: unknown): Promise<Record<string, string>> => {
    if (typeof folder !== 'string') return {};
    const { readWorkspaceApp } = await import('./workspaceAppServer');
    return readWorkspaceApp(folder);
  });

  ipcMain.handle('workspace-app:write', async (_event, folder: unknown, files: unknown): Promise<number> => {
    if (typeof folder !== 'string' || typeof files !== 'object' || files === null) return 0;
    const { writeWorkspaceApp } = await import('./workspaceAppServer');
    return writeWorkspaceApp(folder, files as Record<string, string>);
  });

  ipcMain.handle('workspace-app:remove', async (_event, folder: unknown): Promise<void> => {
    if (typeof folder !== 'string') return;
    const { removeWorkspaceApp } = await import('./workspaceAppServer');
    await removeWorkspaceApp(folder);
  });
}
