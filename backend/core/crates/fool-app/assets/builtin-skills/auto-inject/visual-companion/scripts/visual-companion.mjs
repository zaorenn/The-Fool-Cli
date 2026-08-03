import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HOST = '127.0.0.1';
const MAX_EVENT_BYTES = 16 * 1024;
const ALLOWED_EVENTS = new Set(['design.comment', 'design.approved']);

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const json = (response, status, value) => {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
};

const tokenFrom = (requestUrl) => new URL(requestUrl, `http://${HOST}`).searchParams.get('token');

const reviewPage = (token, title, nonce) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Visual Companion — ${title.replace(/[<>]/g, '')}</title>
<style nonce="${nonce}">
:root{color-scheme:light dark;font:14px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}body{margin:0;background:Canvas;color:CanvasText;overflow:hidden}
iframe{position:fixed;inset:0;width:100%;height:100%;border:0;background:Canvas}
.dock{position:fixed;z-index:2;left:50%;bottom:18px;display:flex;align-items:center;gap:8px;transform:translateX(-50%);padding:8px;border:1px solid color-mix(in srgb,CanvasText 16%,transparent);border-radius:14px;background:color-mix(in srgb,Canvas 88%,transparent);box-shadow:0 12px 42px color-mix(in srgb,CanvasText 18%,transparent);backdrop-filter:blur(18px)}
button{appearance:none;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:9px;padding:9px 13px;background:ButtonFace;color:ButtonText;font:600 13px/1 ui-sans-serif,system-ui;cursor:pointer}
button:hover{filter:brightness(1.04)}button[data-kind=approve]{border-color:AccentColor;background:AccentColor;color:AccentColorText}
.status{max-width:240px;padding:0 5px;color:GrayText;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style></head><body>
<iframe title="Design preview" sandbox="allow-scripts allow-forms allow-modals" src="/design?token=${token}"></iframe>
<div class="dock" role="toolbar" aria-label="Visual Companion review">
  <span class="status" id="status">Review the interactive draft</span>
  <button id="comment" type="button">Leave a comment</button>
  <button id="approve" data-kind="approve" type="button">Approve design</button>
</div>
<script nonce="${nonce}">
const send=async(type,payload={})=>{const status=document.querySelector('#status');status.textContent='Sending…';const response=await fetch('/events?token=${token}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,...payload})});status.textContent=response.ok?(type==='design.approved'?'Approved — the agent can implement':'Comment sent'):'Could not send feedback'};
document.querySelector('#comment').addEventListener('click',()=>{const text=prompt('What should change?');if(text&&text.trim())void send('design.comment',{text:text.trim(),location:location.pathname})});
document.querySelector('#approve').addEventListener('click',()=>void send('design.approved',{location:location.pathname}));
</script></body></html>`;

const serve = async ([htmlPath, token, handshakePath, eventsPath, sessionId]) => {
  const sourcePath = resolve(htmlPath);
  const events = [];
  const server = createServer(async (request, response) => {
    const url = request.url ?? '/';
    if (tokenFrom(url) !== token) return json(response, 403, { error: 'forbidden' });
    const parsed = new URL(url, `http://${HOST}`);

    if (request.method === 'GET' && parsed.pathname === '/') {
      const nonce = randomBytes(18).toString('base64');
      const body = reviewPage(token, basename(sourcePath), nonce);
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
        'content-security-policy': `default-src 'self'; frame-src 'self'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data: blob:`,
      });
      response.end(body);
      return;
    }

    if (request.method === 'GET' && parsed.pathname === '/design') {
      try {
        const body = readFileSync(sourcePath);
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': body.byteLength,
          'cache-control': 'no-store',
          'content-security-policy':
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:",
        });
        response.end(body);
      } catch {
        json(response, 404, { error: 'design-not-found' });
      }
      return;
    }

    if (request.method === 'GET' && parsed.pathname === '/events') return json(response, 200, events);
    if (request.method === 'POST' && parsed.pathname === '/events') {
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_EVENT_BYTES) return json(response, 413, { error: 'event-too-large' });
        chunks.push(chunk);
      }
      try {
        const incoming = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!incoming || !ALLOWED_EVENTS.has(incoming.type)) return json(response, 400, { error: 'invalid-event' });
        const event = {
          id: randomBytes(8).toString('hex'),
          type: incoming.type,
          text: typeof incoming.text === 'string' ? incoming.text.slice(0, 4000) : undefined,
          location: typeof incoming.location === 'string' ? incoming.location.slice(0, 500) : undefined,
          createdAt: new Date().toISOString(),
        };
        events.push(event);
        writeFileSync(eventsPath, JSON.stringify(events, null, 2));
        return json(response, 201, event);
      } catch {
        return json(response, 400, { error: 'invalid-json' });
      }
    }
    json(response, 404, { error: 'not-found' });
  });

  server.listen(0, HOST, () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const url = `http://${HOST}:${port}/?token=${token}`;
    writeFileSync(handshakePath, JSON.stringify({ url, sessionId, eventsPath }));
  });
};

const start = async ([htmlPath]) => {
  if (!htmlPath) throw new Error('Usage: visual-companion.mjs start <absolute-html-path>');
  const token = randomBytes(24).toString('base64url');
  const sessionId = randomBytes(10).toString('hex');
  const handshakePath = resolve(tmpdir(), `the-fool-visual-${sessionId}.json`);
  const eventsPath = resolve(tmpdir(), `the-fool-visual-${sessionId}-events.json`);
  writeFileSync(eventsPath, '[]');
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), 'serve', resolve(htmlPath), token, handshakePath, eventsPath, sessionId],
    { detached: true, stdio: 'ignore', windowsHide: true }
  );
  child.unref();
  for (let attempt = 0; attempt < 60 && !existsSync(handshakePath); attempt += 1) await delay(50);
  if (!existsSync(handshakePath)) throw new Error('Visual Companion server did not start');
  const handshake = JSON.parse(readFileSync(handshakePath, 'utf8'));
  const script = fileURLToPath(import.meta.url);
  console.log(
    JSON.stringify({
      ...handshake,
      eventsCommand: `node "${script}" events "${handshake.url}"`,
    })
  );
};

const printEvents = async ([sessionUrl]) => {
  if (!sessionUrl) throw new Error('Usage: visual-companion.mjs events <session-url>');
  const url = new URL(sessionUrl);
  url.pathname = '/events';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not read events (${response.status})`);
  console.log(JSON.stringify(await response.json(), null, 2));
};

const [command, ...args] = process.argv.slice(2);
if (command === 'serve') await serve(args);
else if (command === 'start') await start(args);
else if (command === 'events') await printEvents(args);
else throw new Error('Commands: start, events');
