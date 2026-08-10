import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { ConfigStorage } from '@/common/config/storage';
import { ipcBridge } from '@/common';

export const settingsControlHandshakePath = (): string => {
  try {
    return path.join(app.getPath('userData'), 'fool', 'settings-control.json');
  } catch {
    return '';
  }
};

let server: Server | null = null;
let token: string | null = null;

const unauthorized = (): { status: number; body: unknown } => ({
  status: 401,
  body: { ok: false, error: 'bad token' },
});

const readBody = (request: import('node:http').IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        request.destroy();
        reject(new Error('command too large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });

export async function startSettingsControlServer(): Promise<void> {
  if (server) return;

  token = randomBytes(32).toString('hex');
  const instance = createServer((request, response) => {
    void (async () => {
      const reply = (status: number, body: unknown): void => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      };

      try {
        if (request.method !== 'POST') return reply(405, { ok: false, error: 'POST only' });
        if (request.headers.authorization !== `Bearer ${token}`) {
          const { status, body } = unauthorized();
          return reply(status, body);
        }

        const raw = await readBody(request);
        let payload: any;
        try {
          payload = JSON.parse(raw);
        } catch {
          return reply(400, { ok: false, error: 'body is not JSON' });
        }

        const cmd = payload.command;
        if (cmd?.name === 'set_theme') {
          await ConfigStorage.set('theme.activeId', cmd.themeId);
          ipcBridge.systemSettings.languageChanged.emit({ language: 'en-US' }); // trigger a UI refresh conceptually, or wait, we just set ConfigStorage
          return reply(200, { ok: true, data: { success: true } });
        } else if (cmd?.name === 'get_settings') {
          const themeId = await ConfigStorage.get('theme.activeId');
          return reply(200, { ok: true, data: { themeId } });
        }

        return reply(400, { ok: false, error: 'unknown command' });
      } catch (error) {
        return reply(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  await new Promise<void>((resolve) => {
    instance.on('error', (error) => {
      console.warn('[SettingsControl] the endpoint could not start:', error.message);
      resolve();
    });
    instance.listen(0, '127.0.0.1', () => {
      const address = instance.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      try {
        const file = settingsControlHandshakePath();
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({ port, token }), { encoding: 'utf8', mode: 0o600 });
        server = instance;
        console.info('[SettingsControl] listening on 127.0.0.1:%d', port);
      } catch (error) {
        console.warn('[SettingsControl] could not publish the handshake file:', error);
      }
      resolve();
    });
  });
}

export function stopSettingsControlServer(): void {
  const instance = server;
  server = null;
  token = null;
  try {
    rmSync(settingsControlHandshakePath(), { force: true });
  } catch {
    // nothing
  }
  if (!instance) return;
  instance.closeAllConnections?.();
  instance.close();
}
