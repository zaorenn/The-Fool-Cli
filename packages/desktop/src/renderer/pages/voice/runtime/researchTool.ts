/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Finding something on the web, and putting it in front of the user here.
 *
 * The request this closes is "find me a PDF about X and open it". Before this,
 * the only thing the spoken assistant could do with the web was open a tab in
 * the user's own browser — so the search took over their screen and the second
 * half, opening the document, had to be done by an agent driving their pointer
 * through it, for minutes, while they watched.
 *
 * Nothing here opens a browser. The results page is fetched in the main
 * process, the file is saved into a folder this app owns, and the viewer is the
 * one beside the conversation.
 */

import type { ResearchKind, WebResult } from '@/common/research/webResults';
import { openDocument, type OpenedDocument } from './documentTool';
import type { ToolHost } from './types';

export type ResearchOutcome =
  | { ok: true; found: WebResult[]; opened?: OpenedDocument; chosen?: WebResult }
  | { ok: false; error: string };

/** How many results are worth handing back for the model to talk about. */
const REPORTED = 5;

/**
 * The kind of thing being looked for, from whatever the model actually sent.
 *
 * Small local models send the enum about as often as they send a word of their
 * own, and a request for a paper that arrives as `kind: "paper"` must not
 * silently become an ordinary page search — that is the difference between
 * coming back with the document and coming back with an article about it.
 */
export const readKind = (raw: string): ResearchKind => {
  const said = raw.trim().toLowerCase();
  if (said.length === 0) return 'page';
  if (/pdf|paper|article|makale|belge|rapor/u.test(said)) return 'pdf';
  if (/doc|word|excel|sheet|spreadsheet|slide|sunum|tablo/u.test(said)) return 'doc';
  return 'page';
};

/**
 * What to say when a search comes back with nothing usable.
 *
 * Each reason gets its own sentence, and the distinction matters more than it
 * looks. "The results page could not be read" is a fault in this application;
 * "there is nothing out there" is a claim about the world. Given one message
 * for both, a model says the second — and the user believes it.
 */
const failureKey = (reason: string): string => {
  switch (reason) {
    case 'search-unreadable':
      return 'settings.voice.conversationResearchUnreadable';
    case 'nothing-found':
      return 'settings.voice.conversationResearchNothing';
    case 'too-large':
      return 'settings.voice.conversationResearchTooLarge';
    case 'refused-kind':
      return 'settings.voice.conversationResearchRefused';
    default:
      return 'settings.voice.conversationResearchUnreachable';
  }
};

export const runResearchTool = async (
  host: ToolHost,
  callId: string,
  args: { query: string; kind: string; open: boolean }
): Promise<ResearchOutcome> => {
  const { t } = host;
  const query = args.query.trim();
  if (query.length === 0) return { ok: false, error: t('settings.voice.conversationActionUnsupported') };

  const find = window.electronAPI?.findOnWeb;
  if (typeof find !== 'function') return { ok: false, error: t('settings.voice.conversationActionUnsupported') };

  host.updateActivity(callId, { detail: t('settings.voice.conversationResearching', { query }), state: 'running' });

  const kind = readKind(args.kind);
  const answer = await find({ query, kind, fetch: args.open }).catch((): null => null);

  // Two checks rather than one `||`: the union narrows on `status` alone, and
  // combining the null test with it loses the narrowing on the other side.
  const stop = (reason: string): ResearchOutcome => {
    const error = t(failureKey(reason));
    host.updateActivity(callId, { detail: error, state: 'failed' });
    host.backToListening();
    return { ok: false, error };
  };

  if (!answer) return stop('unreachable');
  if (answer.status === 'failed') return stop(answer.reason);

  // Opened here rather than in the main process: the viewer is a renderer
  // surface, and the main process has no business knowing which panel a PDF
  // belongs in.
  let opened: OpenedDocument | undefined;
  if (args.open && answer.saved) {
    opened = (await openDocument(answer.saved.path).catch((): undefined => undefined)) ?? undefined;
  }

  const detail = opened
    ? t('settings.voice.conversationResearchOpened', { title: answer.chosen?.title ?? opened.name })
    : t('settings.voice.conversationResearchFound', { count: answer.results.length });
  host.updateActivity(callId, { detail, state: 'completed' });
  host.backToListening();

  return {
    ok: true,
    // Trimmed, and titles rather than addresses: the model is about to say this
    // out loud, and nobody wants a URL read to them one character at a time.
    found: answer.results.slice(0, REPORTED),
    ...(answer.chosen ? { chosen: answer.chosen } : {}),
    ...(opened ? { opened } : {}),
  };
};
