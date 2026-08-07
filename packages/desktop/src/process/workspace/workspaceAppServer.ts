/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { createServer, type Server } from 'node:http';
import { createReadStream, type Dirent } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE_APP_BRIDGE } from '@/common/config/workspaceApp';

/**
 * Serving a workspace's own page, over loopback, with the bridge in it.
 *
 * A file:// page cannot talk to its parent the way this needs to, and a page
 * served from anywhere else is a page on the internet. So it is an HTTP server
 * on 127.0.0.1, bound to nothing else, serving exactly one directory.
 *
 * Two things it must never do, both of which are the reason this is a module
 * rather than three lines in a handler. It must not serve outside the folder it
 * was pointed at — every request path is resolved and checked against the root,
 * so `../../..` reaches nothing. And it must not be reachable from another
 * machine: bound to loopback explicitly rather than to whatever the default is.
 *
 * The bridge is injected into the served HTML rather than expected of the page.
 * These pages are written by a model from something somebody said out loud, and
 * a contract the author has to remember is a contract that will be got wrong.
 */

/** Where workspace apps live, beside the other things the app builds for itself. */
export const workspaceAppRoot = (): string => path.join(app.getPath('userData'), 'fool', 'workspace-apps');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

export type ServedApp =
  | { ok: true; url: string; root: string }
  | { ok: false; reason: 'not-a-folder' | 'no-entry' | 'failed' };

let server: Server | null = null;
let servedRoot = '';

/** Confines any path to the workspace-app root, refusing anything outside it. */
const insideRoot = (wanted: string): string | null => {
  const root = path.resolve(workspaceAppRoot());
  const resolved = path.resolve(wanted);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return resolved === root || resolved.startsWith(prefix) ? resolved : null;
};

/** The file a request is asking for, or null when it is asking for the way out. */
const resolveRequest = (root: string, url: string): string | null => {
  const pathname = decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname);
  const wanted = path.resolve(root, `.${pathname}`);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return wanted === root || wanted.startsWith(prefix) ? wanted : null;
};

/**
 * Puts the bridge into a page before it is sent.
 *
 * Before anything else in the document, so a script that runs on load already
 * has `window.fool` — an app whose first line calls it must not have to wait for
 * a ready event nobody told its author about.
 */
const withBridge = (html: string): string => {
  const script = `<script>${WORKSPACE_APP_BRIDGE}</script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (match) => `${match}\n${script}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (match) => `${match}\n${script}`);
  return `${script}\n${html}`;
};

/** Stops whatever is being served. One at a time; a second call replaces the first. */
export const stopWorkspaceApp = async (): Promise<void> => {
  const running = server;
  server = null;
  servedRoot = '';
  if (!running) return;
  await new Promise<void>((resolve) => running.close(() => resolve()));
};

/**
 * Serves one workspace app and answers with where to open it.
 *
 * Port zero: the operating system picks a free one, so two copies of the app —
 * or another program that happened to take a fixed port — cannot collide.
 */
export const serveWorkspaceApp = async (folder: string, entry: string): Promise<ServedApp> => {
  const root = insideRoot(path.join(workspaceAppRoot(), folder));
  if (!root) return { ok: false, reason: 'not-a-folder' };

  try {
    const info = await stat(root);
    if (!info.isDirectory()) return { ok: false, reason: 'not-a-folder' };
    await stat(path.join(root, entry));
  } catch {
    return { ok: false, reason: 'no-entry' };
  }

  await stopWorkspaceApp();

  const created = createServer((request, response) => {
    const target = request.url ? resolveRequest(root, request.url) : null;
    if (!target) {
      response.writeHead(403).end();
      return;
    }

    void (async () => {
      let file = target;
      try {
        const info = await stat(file);
        if (info.isDirectory()) file = path.join(file, 'index.html');
      } catch {
        response.writeHead(404).end();
        return;
      }

      const extension = path.extname(file).toLowerCase();
      const type = MIME[extension] ?? 'application/octet-stream';

      if (extension === '.html') {
        try {
          const html = await readFile(file, 'utf8');
          response.writeHead(200, { 'Content-Type': type }).end(withBridge(html));
        } catch {
          response.writeHead(404).end();
        }
        return;
      }

      response.writeHead(200, { 'Content-Type': type });
      createReadStream(file)
        .on('error', (): void => {
          response.end();
        })
        .pipe(response);
    })();
  });

  return new Promise<ServedApp>((resolve) => {
    created.on('error', () => resolve({ ok: false, reason: 'failed' }));
    // Loopback explicitly. A workspace app is for the person at this machine and
    // binding to every interface would put a generated page on their network.
    created.listen(0, '127.0.0.1', () => {
      const address = created.address();
      if (address === null || typeof address === 'string') {
        resolve({ ok: false, reason: 'failed' });
        return;
      }
      server = created;
      servedRoot = root;
      resolve({ ok: true, url: `http://127.0.0.1:${address.port}/${entry}`, root });
    });
  });
};

/** What is being served right now, for anything that needs to know. */
export const servedWorkspaceRoot = (): string => servedRoot;

/** Makes the folder a new app is written into, and answers with where it is. */
export const prepareWorkspaceApp = async (folder: string): Promise<string> => {
  const target = insideRoot(path.join(workspaceAppRoot(), folder));
  if (!target) throw new Error('WORKSPACE_APP_BAD_FOLDER');
  await mkdir(target, { recursive: true });
  return target;
};

/** Drops a workspace's app when the workspace itself goes. */
export const removeWorkspaceApp = async (folder: string): Promise<void> => {
  const target = insideRoot(path.join(workspaceAppRoot(), folder));
  if (!target || target === path.resolve(workspaceAppRoot())) return;
  await rm(target, { recursive: true, force: true });
};

/**
 * Reads an app's files, for putting one in a file somebody can be sent.
 *
 * Text only, and bounded. A workspace is meant to be small enough to send in a
 * message; an app that bundled a video would defeat that, and reading arbitrary
 * binaries into JSON is a way to build a very large file very quickly.
 */
export const readWorkspaceApp = async (folder: string, limit = 2_000_000): Promise<Record<string, string>> => {
  const root = insideRoot(path.join(workspaceAppRoot(), folder));
  if (!root) return {};

  const files: Record<string, string> = {};
  let total = 0;

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch((): Dirent[] => []);
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(html|css|js|mjs|json|svg|txt|md)$/i.test(entry.name)) continue;

      const contents = await readFile(full, 'utf8').catch(() => '');
      total += contents.length;
      if (total > limit) return;
      files[path.relative(root, full).replaceAll('\\', '/')] = contents;
    }
  };

  await walk(root);
  return files;
};

/**
 * Writes an app out of a file somebody sent.
 *
 * Each path is confined to the app's own folder before anything is written: the
 * keys of this object came from another person's machine, and a `../` in one of
 * them is the difference between an app and an arbitrary file write.
 */
export const writeWorkspaceApp = async (folder: string, files: Record<string, string>): Promise<number> => {
  const root = await prepareWorkspaceApp(folder);
  let written = 0;

  for (const [name, contents] of Object.entries(files)) {
    if (typeof contents !== 'string') continue;
    const target = path.resolve(root, name);
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if (!target.startsWith(prefix)) continue;

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, 'utf8');
    written += 1;
  }

  return written;
};
