/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer, type Server } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/**
 * Somewhere to look at what the agent just built.
 *
 * Asked out loud to build a web app, the agent writes files and stops, and the
 * user is left with a folder path they were told about in a sentence. Opening it
 * as `file://` is not the answer either: modules, `fetch` and anything with a
 * root-relative path are all refused from that origin, so half of what gets
 * built appears broken through no fault of its own.
 *
 * So there is a real HTTP origin. Loopback, ephemeral port, one directory at a
 * time, and no way to reach outside it — this serves files the agent wrote on
 * the user's instruction, which is not a reason to be careless about what else
 * on the disk is reachable.
 */

/** Where a spoken "build me an app" puts what it builds. */
export const previewWorkspaceRoot = (): string => {
  try {
    return path.join(app.getPath('userData'), 'fool', 'built-apps');
  } catch {
    // Outside a running Electron main process — a test, or the migration path.
    // An empty root is refused by `servePreview` rather than serving the disk.
    return '';
  }
};

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
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
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const contentType = (file: string): string => MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

/**
 * The file a request is asking for, or null when it is asking for something
 * outside the directory being served.
 *
 * Resolved and then checked against the root rather than filtered for `..`:
 * a blocklist of traversal spellings is a losing game, and `path.resolve`
 * already knows what the request actually points at. Symlinks are not followed
 * out either — `realpath` is what the check is applied to.
 */
const resolveWithin = async (root: string, urlPath: string): Promise<string | null> => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }

  const candidate = path.resolve(root, `.${path.posix.normalize(decoded)}`);
  let real: string;
  let realRoot: string;
  try {
    realRoot = await fs.realpath(root);
    const stats = await fs.stat(candidate);
    real = await fs.realpath(stats.isDirectory() ? path.join(candidate, 'index.html') : candidate);
  } catch {
    return null;
  }

  const prefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (real !== realRoot && !real.startsWith(prefix)) return null;
  return real;
};

let server: Server | null = null;
let servedRoot = '';

/** Shuts the current preview down, if there is one. */
export const stopPreview = async (): Promise<void> => {
  const running = server;
  server = null;
  servedRoot = '';
  if (!running) return;
  await new Promise<void>((resolve) => running.close(() => resolve()));
};

export type PreviewResult = { ok: true; url: string } | { ok: false; reason: 'no-entry' | 'not-a-folder' | 'failed' };

/**
 * Serves one directory and hands back the address to open.
 *
 * One at a time: a second call replaces the first rather than accumulating
 * servers nobody will ever close. The previous preview's tab stops working,
 * which is correct — it is showing something the user has moved on from.
 *
 * Refuses a directory with no `index.html`, because there would be nothing to
 * show and a blank page is the worst way to report that.
 */
export const servePreview = async (directory: string): Promise<PreviewResult> => {
  const root = path.resolve(directory);
  try {
    const stats = await fs.stat(root);
    if (!stats.isDirectory()) return { ok: false, reason: 'not-a-folder' };
    await fs.access(path.join(root, 'index.html'));
  } catch {
    return { ok: false, reason: 'no-entry' };
  }

  await stopPreview();

  const next = createServer((request, response) => {
    void (async () => {
      const file = await resolveWithin(root, request.url ?? '/');
      if (!file) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': contentType(file),
        // Nothing here is worth caching: the whole point is that the agent is
        // still editing it, and a reload has to show what it wrote.
        'Cache-Control': 'no-store',
      });
      createReadStream(file)
        .on('error', () => response.destroy())
        .pipe(response);
    })();
  });

  return new Promise<PreviewResult>((resolve) => {
    next.once('error', () => resolve({ ok: false, reason: 'failed' }));
    // Loopback and an ephemeral port: this is the user's own work-in-progress,
    // and nothing about it belongs on an interface another machine can reach.
    next.listen(0, '127.0.0.1', () => {
      const address = next.address();
      if (address === null || typeof address === 'string') {
        resolve({ ok: false, reason: 'failed' });
        return;
      }
      server = next;
      servedRoot = root;
      resolve({ ok: true, url: `http://127.0.0.1:${address.port}/` });
    });
  });
};

/** What is being previewed right now, for anything that wants to say so. */
export const previewedDirectory = (): string => servedRoot;
