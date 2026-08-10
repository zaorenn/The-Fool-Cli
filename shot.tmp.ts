/**
 * A picture of the running app, and a way to drive it.
 *
 * Usage:
 *   bun run shot.tmp.ts <out.png>                  — capture
 *   bun run shot.tmp.ts <out.png> "#/settings/..." — navigate, then capture
 *   bun run shot.tmp.ts <out.png> --eval "expr"    — evaluate, then capture
 */

const PORT = 9222;

type Target = { type: string; url: string; webSocketDebuggerUrl: string };

const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as Target[];
const page = targets.find((target) => target.type === 'page' && target.url.includes('index.html'));
if (!page) throw new Error('no renderer target');

const socket = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const waiting = new Map<number, (value: Record<string, unknown>) => void>();

const send = (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => waiting.set(id, resolve));
};

socket.addEventListener('message', (event) => {
  const frame = JSON.parse(String(event.data)) as { id?: number; result?: Record<string, unknown> };
  if (frame.id && waiting.has(frame.id)) {
    waiting.get(frame.id)?.(frame.result ?? {});
    waiting.delete(frame.id);
  }
});

await new Promise((resolve) => socket.addEventListener('open', resolve));

const [out, ...rest] = process.argv.slice(2);

if (rest[0] === '--eval') {
  const result = await send('Runtime.evaluate', { expression: rest[1], awaitPromise: true, returnByValue: true });
  console.log('eval:', JSON.stringify(result).slice(0, 600));
  await Bun.sleep(1200);
} else if (rest[0]) {
  await send('Runtime.evaluate', { expression: `location.hash = ${JSON.stringify(rest[0])}` });
  await Bun.sleep(2500);
}

const shot = (await send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
if (!shot.data) throw new Error('no image came back');
await Bun.write(out, Buffer.from(shot.data, 'base64'));
console.log('wrote', out);
socket.close();
