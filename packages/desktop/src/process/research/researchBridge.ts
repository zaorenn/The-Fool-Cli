/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How the renderer asks for something to be found on the web.
 *
 * Pull-only, and there is deliberately no handler here that opens anything.
 * Every route the spoken assistant previously had to the web went through
 * `shell.openExternal`, which put a tab in front of the user for a request that
 * was about a document rather than about their browser. This one fetches, saves
 * and answers with a path; what to do with that path is the renderer's
 * decision, and it is a viewer inside this app.
 *
 * The store is imported inside the handlers rather than at the top: bridges are
 * wired before Electron is ready, and it reaches for the user data directory.
 */

import { ipcMain } from 'electron';
import type { ResearchKind, WebResult } from '@/common/research/webResults';

/**
 * Discriminated by a string, not by `ok: true/false`.
 *
 * This project builds without `strictNullChecks`, under which a boolean literal
 * does not narrow a union: the compiler keeps both arms alive and every field
 * access on either becomes an error at the call site.
 */
export type ResearchOutcome =
  | { status: 'found'; results: WebResult[]; chosen?: WebResult; saved?: { path: string; bytes: number } }
  | { status: 'failed'; reason: string; detail?: string };

/** One file that was fetched on the user's behalf and is still on disk. */
export type FoundDocument = { path: string; name: string; bytes: number; at: number };

let registered = false;

export function initResearchBridge(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle(
    'research:find',
    async (_event, payload: { query?: string; kind?: ResearchKind; fetch?: boolean }): Promise<ResearchOutcome> => {
      const query = typeof payload?.query === 'string' ? payload.query.trim() : '';
      if (query.length === 0) return { status: 'failed', reason: 'nothing-found' };

      const kind: ResearchKind =
        payload?.kind === 'pdf' || payload?.kind === 'doc' || payload?.kind === 'page' ? payload.kind : 'page';

      const { research, ResearchError } = await import('./researchStore');
      try {
        const found = await research(query, kind, payload?.fetch === true);
        return { status: 'found', ...found };
      } catch (error) {
        // Reported with its own reason rather than as a generic failure. The
        // assistant's next sentence is different for "I could not read the
        // results page" and "there is nothing out there", and a model handed
        // one message for both will say the second when the first was true.
        if (error instanceof ResearchError) {
          return { status: 'failed', reason: error.reason, detail: error.message };
        }
        return { status: 'failed', reason: 'unreachable', detail: error instanceof Error ? error.message : undefined };
      }
    }
  );

  /**
   * What has been fetched and is still there, newest first.
   *
   * Read off the disk rather than out of the conversation, and that is the
   * point of it. Auto-opening a document is one call in the renderer and it
   * has failed on its own — silently, while the tool reported success — which
   * left the user with a file they had been told about and no way to reach.
   * The transcript is not that way back: it is gone at the next launch, and
   * the document is not.
   */
  ipcMain.handle('research:list-found', async (): Promise<FoundDocument[]> => {
    const { researchFolder } = await import('./researchStore');
    const folder = researchFolder();
    if (folder.length === 0) return [];

    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');

    // A folder that does not exist yet is "nothing found so far", which is a
    // true answer on a fresh install and not a failure to report.
    //
    // Annotated because the bare `[]` in the catch infers as an empty tuple,
    // and without `strictNullChecks` the union with it collapses to `never`.
    type DirEntry = { name: string; isFile: () => boolean };
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch((): DirEntry[] => []);

    const documents = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry): Promise<FoundDocument | null> => {
          const full = path.join(folder, entry.name);
          const stat = await fs.stat(full).catch((): null => null);
          if (!stat) return null;
          return { path: full, name: entry.name, bytes: stat.size, at: stat.mtimeMs };
        })
    );

    return documents.filter((document): document is FoundDocument => document !== null).toSorted((a, b) => b.at - a.at);
  });
}
