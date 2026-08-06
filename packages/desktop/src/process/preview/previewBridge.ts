/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcMain } from 'electron';
import type { PreviewResult } from './previewServer';

/**
 * How the renderer asks for something to be served.
 *
 * The directory is not taken on trust. Everything served this way was built at
 * this app's own request, in a folder this module chose, so the handler confines
 * whatever it is given to that root rather than serving any path a renderer
 * happens to name — the alternative is an HTTP origin onto the whole disk, one
 * prompt injection away from being aimed somewhere else.
 *
 * The server module is imported inside the handlers rather than at the top: the
 * bridges are wired before Electron is ready, and it reaches for the user data
 * directory at module scope.
 */

let registered = false;

export function initPreviewBridge(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle('preview:workspace-root', async (): Promise<string> => {
    const { previewWorkspaceRoot } = await import('./previewServer');
    return previewWorkspaceRoot();
  });

  ipcMain.handle('preview:serve', async (_event, directory: unknown): Promise<PreviewResult> => {
    if (typeof directory !== 'string' || directory.trim().length === 0) return { ok: false, reason: 'not-a-folder' };

    const [{ previewWorkspaceRoot, servePreview }, path] = await Promise.all([
      import('./previewServer'),
      import('node:path'),
    ]);

    const root = previewWorkspaceRoot();
    if (root.length === 0) return { ok: false, reason: 'failed' };

    // Inside the folder this app builds into, and nowhere else. A renderer that
    // has been talked into asking for `C:\Users` gets a refusal rather than a
    // web server pointed at the user's documents.
    const wanted = path.resolve(directory);
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if (wanted !== root && !wanted.startsWith(prefix)) return { ok: false, reason: 'not-a-folder' };

    return servePreview(wanted);
  });

  ipcMain.handle('preview:stop', async (): Promise<void> => {
    const { stopPreview } = await import('./previewServer');
    await stopPreview();
  });
}
