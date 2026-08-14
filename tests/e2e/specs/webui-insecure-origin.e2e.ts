/**
 * Loads the built WebUI in a real browser from an origin that is not a secure
 * context, which is what a phone on the local network gets.
 *
 * Every other test in this directory launches Electron. Electron's window is a
 * secure context and it paints frames, so two whole classes of failure were
 * invisible to the suite: APIs that only exist in a secure context, and work
 * that waits on an animation frame. Both shipped. `crypto.randomUUID` is
 * undefined over plain HTTP on a LAN address, and the first call threw during
 * module evaluation, so remote access was a black window while every test and
 * every build stayed green.
 *
 * The origin here is a hostname mapped to the loopback address rather than a
 * real LAN address: `http://fool.test:PORT` is not a secure context, and unlike
 * an interface address it is the same on every machine and needs no network.
 */

import { test, expect, chromium, type Browser } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const RENDERER_DIR = path.join(process.cwd(), 'out', 'renderer');

/** An origin the browser will not treat as secure, and that resolves anywhere. */
const INSECURE_HOST = 'fool.test';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Serves the built renderer the way the desktop's static server does, including
 * the single-page fallback. The content type on scripts matters: a module served
 * as text/html is refused by the browser, which would make this test fail for a
 * reason that has nothing to do with what it is checking.
 */
function serveRenderer(): Promise<http.Server> {
  const server = http.createServer((request, response) => {
    const requestPath = new URL(request.url ?? '/', 'http://placeholder').pathname;
    const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    let file = path.join(RENDERER_DIR, relative);

    if (!file.startsWith(RENDERER_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(RENDERER_DIR, 'index.html');
    }

    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(response);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test.describe('WebUI over an insecure origin', () => {
  let server: http.Server;
  let browser: Browser;
  let origin: string;
  const pageErrors: string[] = [];

  test.beforeAll(async () => {
    if (!fs.existsSync(path.join(RENDERER_DIR, 'index.html'))) {
      throw new Error(
        `No built renderer at ${RENDERER_DIR}. Run \`bun run package\` before the e2e suite.`
      );
    }

    server = await serveRenderer();
    const { port } = server.address() as AddressInfo;
    origin = `http://${INSECURE_HOST}:${port}`;

    browser = await chromium.launch({
      args: [`--host-resolver-rules=MAP ${INSECURE_HOST} 127.0.0.1`],
    });
  });

  test.afterAll(async () => {
    await browser?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  test('mounts the app instead of leaving a blank page', async () => {
    const page = await browser.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(origin, { waitUntil: 'domcontentloaded' });

    // Guards the premise: if this ever reports true the test has stopped
    // exercising the case it exists for, and would pass for the wrong reason.
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);

    await expect
      .poll(() => page.evaluate(() => document.getElementById('root')?.children.length ?? 0), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    expect(pageErrors).toEqual([]);
    await page.close();
  });

  test('retires the boot splash', async () => {
    const page = await browser.newPage();
    await page.goto(origin, { waitUntil: 'domcontentloaded' });

    // The splash covers the viewport at z-index 9999, so an app that mounts
    // underneath one that never leaves is still a blank window to the user.
    await expect
      .poll(() => page.evaluate(() => document.getElementById('boot-splash') !== null), {
        timeout: 20_000,
      })
      .toBe(false);

    await page.close();
  });

  test('has a working crypto.randomUUID', async () => {
    const page = await browser.newPage();
    await page.goto(origin, { waitUntil: 'domcontentloaded' });

    const uuid = await page.evaluate(() => crypto.randomUUID());

    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await page.close();
  });
});
