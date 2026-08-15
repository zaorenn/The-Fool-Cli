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
}
