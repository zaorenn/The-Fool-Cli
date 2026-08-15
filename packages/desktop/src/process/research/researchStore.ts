/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Looking something up on the web, and keeping what was found.
 *
 * The whole of "find me a PDF about X and open it", minus the opening. Nothing
 * here touches the user's browser: the results page is fetched, parsed and
 * thrown away, and the file lands in a folder this app owns.
 *
 * The rules on what may be written are the same ones the agent's `Download`
 * tool applies, and for the same reasons — the address came from a model, which
 * got it from a page a stranger wrote. They are restated rather than shared
 * because the two live in different languages and different processes, and a
 * cross-process import for six checks would be worse than two honest copies
 * that each say why they exist.
 */

import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { bestResult, parseResults, searchUrl, type ResearchKind, type WebResult } from '@/common/research/webResults';

/**
 * A browser's own headers.
 *
 * Without them the results page comes back as a consent wall or a robot check,
 * which has no results in it to read. The same reason `findVideo` sends them.
 */
const BROWSER_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

const SEARCH_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** The largest file one request may put on the user's disk. */
const MAX_BYTES = 64 * 1024 * 1024;

/** Never written, whatever the server calls the file. */
const REFUSED_EXTENSIONS = new Set([
  'exe',
  'msi',
  'bat',
  'cmd',
  'com',
  'scr',
  'ps1',
  'psm1',
  'dll',
  'sys',
  'lnk',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'hta',
  'cpl',
  'jar',
  'app',
  'pkg',
  'dmg',
  'deb',
  'rpm',
  'sh',
  'bash',
  'zsh',
]);

/** Where anything found on the user's behalf is kept. */
export const researchFolder = (): string => {
  try {
    return path.join(app.getPath('userData'), 'fool', 'found');
  } catch {
    // Outside a running main process — a test. An empty root makes `save`
    // refuse rather than write somewhere arbitrary.
    return '';
  }
};

/** Everything that can go wrong, in words the assistant can say out loud. */
export type ResearchFailure =
  /** The results page could not be read. Not the same as finding nothing. */
  | 'search-unreadable'
  /** The search worked and the web genuinely has nothing for this. */
  | 'nothing-found'
  /** The address could not be fetched. */
  | 'unreachable'
  /** The file is bigger than one request may write. */
  | 'too-large'
  /** The server sent a kind of file this will not save. */
  | 'refused-kind'
  /** The bytes could not be written. */
  | 'write-failed';

export class ResearchError extends Error {
  public readonly reason: ResearchFailure;

  public constructor(reason: ResearchFailure, detail?: string) {
    super(detail ?? reason);
    this.name = 'ResearchError';
    this.reason = reason;
  }
}

const withTimeout = async (url: string, ms: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, headers: BROWSER_HEADERS, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
};

/**
 * What the web has for a query, without a browser and without an account.
 *
 * An unreadable results page is reported as exactly that. It must never be
 * turned into "nothing was found": the model repeats that to the user as a fact
 * about the world, when it is a fact about this parser and somebody else's
 * markup.
 */
export const searchWeb = async (query: string, kind: ResearchKind = 'page'): Promise<WebResult[]> => {
  const wanted = query.trim();
  if (wanted.length === 0) return [];

  let html: string;
  try {
    const response = await withTimeout(searchUrl(wanted, kind), SEARCH_TIMEOUT_MS);
    if (!response.ok) throw new ResearchError('search-unreadable', `the search page answered ${response.status}`);
    html = await response.text();
  } catch (error) {
    if (error instanceof ResearchError) throw error;
    throw new ResearchError('search-unreadable', error instanceof Error ? error.message : undefined);
  }

  const results = parseResults(html);
  if (results.length === 0) {
    throw new ResearchError('search-unreadable', 'the results page could not be read');
  }
  return results;
};

/** The extension a file's first bytes actually indicate, or null. */
const sniff = (bytes: Uint8Array): string | null => {
  const starts = (signature: readonly number[]): boolean => signature.every((byte, index) => bytes[index] === byte);

  if (starts([0x25, 0x50, 0x44, 0x46])) return 'pdf';
  if (starts([0x50, 0x4b, 0x03, 0x04])) return 'zip';
  if (starts([0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (starts([0xff, 0xd8, 0xff])) return 'jpg';
  if (starts([0x7f, 0x45, 0x4c, 0x46])) return 'elf';
  if (starts([0x4d, 0x5a])) return 'exe';
  return null;
};

/**
 * A name that cannot leave the folder it is joined to.
 *
 * Directory components are dropped rather than rejected: an address ending in
 * `../../autorun.inf` is describing a file called `autorun.inf`, and the
 * interesting half of that string is the half this throws away.
 */
export const safeName = (url: string, fallback: string): string => {
  const fromUrl = url.split(/[?#]/u)[0].split('/').pop() ?? '';
  const bare = (fromUrl.length > 0 ? fromUrl : fallback).split(/[/\\]/u).pop() ?? '';
  const cleaned = bare.replaceAll(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[.-]+/u, '');
  return cleaned.length > 0 ? cleaned.slice(0, 120) : fallback;
};

/**
 * Saves what was found, into a folder this app owns.
 *
 * The original address is never handed to the shell and the file is never
 * written anywhere the user did not agree to. A body that turns out to be a
 * program is refused after it has been fetched and before it is written — the
 * bytes are the only honest evidence of what a server actually sent.
 */
export const saveFound = async (url: string, suggestedName?: string): Promise<{ path: string; bytes: number }> => {
  const folder = researchFolder();
  if (folder.length === 0) throw new ResearchError('write-failed', 'no folder to write into');

  let response: Response;
  try {
    response = await withTimeout(url, DOWNLOAD_TIMEOUT_MS);
  } catch (error) {
    throw new ResearchError('unreachable', error instanceof Error ? error.message : undefined);
  }
  if (!response.ok) throw new ResearchError('unreachable', `that address answered ${response.status}`);

  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_BYTES) throw new ResearchError('too-large');

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new ResearchError('too-large');

  const actual = sniff(bytes);
  if (actual === 'exe' || actual === 'elf') throw new ResearchError('refused-kind', actual);

  // The final address after redirects names the file, not the one that was
  // searched for: a DOI resolver's URL has no filename in it.
  const name = safeName(response.url || url, suggestedName ?? 'found');
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (REFUSED_EXTENSIONS.has(extension)) throw new ResearchError('refused-kind', extension);

  const target = path.join(folder, name);
  // Proof rather than trust: `safeName` is where the name is made safe and this
  // is where it is checked, so a later edit to one cannot quietly defeat both.
  if (!path.resolve(target).startsWith(path.resolve(folder) + path.sep)) {
    throw new ResearchError('write-failed', 'that name points outside the folder');
  }

  try {
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(target, bytes);
  } catch (error) {
    throw new ResearchError('write-failed', error instanceof Error ? error.message : undefined);
  }

  return { path: target, bytes: bytes.byteLength };
};

/**
 * Search, choose, and save — the whole of the request, in one call.
 *
 * `open` is the caller's business: this hands back a path, and the renderer
 * decides which viewer it belongs in. Splitting it that way keeps every Node
 * API on this side of the bridge.
 */
export const research = async (
  query: string,
  kind: ResearchKind,
  fetchIt: boolean
): Promise<{ results: WebResult[]; saved?: { path: string; bytes: number }; chosen?: WebResult }> => {
  const results = await searchWeb(query, kind);
  if (!fetchIt) return { results };

  const chosen = bestResult(results, kind);
  if (!chosen) throw new ResearchError('nothing-found');

  return { results, chosen, saved: await saveFound(chosen.url, `${safeName(chosen.url, 'found')}`) };
};
