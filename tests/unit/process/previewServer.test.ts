/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Serving what the agent just built.
 *
 * The security half matters as much as the serving half: this puts an HTTP
 * origin on a folder on the user's disk, and the requests that reach it come
 * from a page the agent itself wrote.
 */

vi.mock('electron', () => ({ app: { getPath: () => root } }));

let root = '';
let site = '';

const { servePreview, stopPreview, previewWorkspaceRoot } = await import('@process/preview/previewServer');

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'fool-preview-'));
  site = path.join(root, 'site');
  await fs.mkdir(path.join(site, 'assets'), { recursive: true });
  await fs.writeFile(path.join(site, 'index.html'), '<h1>built</h1>', 'utf8');
  await fs.writeFile(path.join(site, 'assets', 'app.js'), 'export const x = 1;', 'utf8');
  await fs.writeFile(path.join(root, 'secret.txt'), 'not yours', 'utf8');
});

afterEach(async () => {
  await stopPreview();
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const serve = async (directory: string): Promise<string> => {
  const result = await servePreview(directory);
  if (result.ok === false) throw new Error(result.reason);
  return result.url;
};

describe('servePreview', () => {
  it('serves the page at the root of what was built', async () => {
    const url = await serve(site);

    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<h1>built</h1>');
  });

  it('serves a file beside it, with a type a browser will run', async () => {
    const url = await serve(site);

    const response = await fetch(`${url}assets/app.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/javascript');
  });

  it('binds to loopback only', async () => {
    const url = await serve(site);

    expect(url.startsWith('http://127.0.0.1:')).toBe(true);
  });

  it('does not cache, because the agent is still editing it', async () => {
    const url = await serve(site);

    expect((await fetch(url)).headers.get('cache-control')).toBe('no-store');
  });

  it('refuses to climb out of the folder it is serving', async () => {
    const url = await serve(site);

    for (const attempt of ['../secret.txt', '..%2Fsecret.txt', '%2e%2e/secret.txt', '....//secret.txt']) {
      const response = await fetch(`${url}${attempt}`);
      expect(response.status, attempt).toBe(404);
    }
  });

  it('answers a missing file with a refusal rather than a crash', async () => {
    const url = await serve(site);

    expect((await fetch(`${url}nothing-here.html`)).status).toBe(404);
  });

  it('will not serve a folder with nothing to show', async () => {
    const empty = path.join(root, 'empty');
    await fs.mkdir(empty, { recursive: true });

    expect(await servePreview(empty)).toEqual({ ok: false, reason: 'no-entry' });
  });

  it('will not serve something that is not a folder', async () => {
    expect(await servePreview(path.join(root, 'secret.txt'))).toEqual({ ok: false, reason: 'not-a-folder' });
  });

  it('replaces the previous preview rather than stacking servers', async () => {
    const first = await serve(site);
    const second = await serve(site);

    expect(second).not.toBe(first);
    await expect(fetch(first)).rejects.toThrow();
  });
});

describe('previewWorkspaceRoot', () => {
  it('is a folder of this app’s own, not somewhere the user keeps things', () => {
    expect(previewWorkspaceRoot().endsWith(path.join('fool', 'built-apps'))).toBe(true);
  });
});
