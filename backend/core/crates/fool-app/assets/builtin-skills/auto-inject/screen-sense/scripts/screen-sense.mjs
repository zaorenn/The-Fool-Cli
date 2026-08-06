import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * The desktop, as text.
 *
 * This exists so that a model with no eyes can still work the machine. Windows
 * already knows what is on the screen — the accessibility tree names every
 * control and gives its exact rectangle, and the built-in OCR reads whatever the
 * tree cannot describe. Both run on the CPU, both are already installed, and
 * neither needs a vision model loaded or a graphics card touched.
 *
 * What comes back is a list of things and where they are, which is a better
 * answer than a picture even for a model that could have looked at one: a
 * screenshot has to be reasoned into coordinates, and this reads the coordinates
 * off the control that owns them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'screen.ps1');
const TIMEOUT_MS = 30000;

const runPowerShell = (args, input) =>
  new Promise((done, fail) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args],
      { windowsHide: true }
    );

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error('The screen did not answer in time'));
    }, TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return fail(new Error(err.trim() || `screen.ps1 exited ${code}`));
      try {
        done(JSON.parse(out.trim()));
      } catch {
        fail(new Error(`Could not read the screen: ${out.slice(0, 400)}`));
      }
    });

    if (input !== undefined) child.stdin.end(input, 'utf8');
    else child.stdin.end();
  });

/**
 * A list, whatever the producer sent.
 *
 * `ConvertTo-Json` on Windows PowerShell writes a one-item collection as a bare
 * object and an empty one as nothing at all, so every list field here arrives in
 * one of three shapes. Reading them as arrays regardless is what keeps a screen
 * with a single control — a game, a canvas, some full-screen windows — from
 * failing outright, which is the screen a model most needs described to it.
 */
const asList = (value) => (Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]);

/** A control worth listing: named, or somewhere the user could act. */
const isUseful = (element) =>
  (element.name ?? '').length > 0 || element.clickable || element.typable || element.role === 'Edit';

/**
 * The snapshot as lines a model can act on directly.
 *
 * Text rather than the raw JSON because the JSON is mostly punctuation: the same
 * information costs several times as many tokens, and a long screen is exactly
 * where that matters.
 */
const describe = (snapshot, { withText }) => {
  const lines = [];
  lines.push(`Foreground window: ${snapshot.foreground || '(none)'}`);
  lines.push(`Screen: ${snapshot.screenshot.width}x${snapshot.screenshot.height}`);
  lines.push(`Screenshot saved to: ${snapshot.screenshot.path}`);

  const windows = asList(snapshot.windows);
  if (windows.length > 0) {
    lines.push('', 'Open windows:');
    for (const window of windows) lines.push(`  - ${window.title}`);
  }

  const useful = asList(snapshot.elements).filter(isUseful);
  lines.push('', `Controls (${useful.length}) — click(x,y) is the centre of each:`);
  for (const element of useful) {
    const name = element.name ? `"${element.name}"` : '(unnamed)';
    const value = element.value ? ` = "${element.value}"` : '';
    const flags = [
      element.clickable ? 'clickable' : null,
      element.typable ? 'typable' : null,
      element.enabled ? null : 'disabled',
    ]
      .filter(Boolean)
      .join(' ');
    lines.push(`  [${element.role}] ${name}${value}  click(${element.x},${element.y})  ${flags}`.trimEnd());
  }

  const text = asList(snapshot.text);
  if (withText && text.length > 0) {
    lines.push('', `Text read from the pixels (${text.length} lines):`);
    for (const line of text) lines.push(`  (${line.x},${line.y}) ${line.text}`);
  }

  return lines.join('\n');
};

const commands = {
  async look(args) {
    const withText = args.includes('--text');
    const limitFlag = args.find((arg) => arg.startsWith('--limit='));
    const limit = limitFlag ? Number(limitFlag.split('=')[1]) : 200;
    const snapshot = await runPowerShell(['look', String(limit), withText ? 'text' : 'no-text']);
    console.log(args.includes('--json') ? JSON.stringify(snapshot) : describe(snapshot, { withText }));
  },

  async read() {
    const result = await runPowerShell(['read']);
    const text = asList(result.text);
    if (text.length === 0) {
      console.log('No text could be read from the screen.');
      return;
    }
    console.log(text.map((line) => `(${line.x},${line.y}) ${line.text}`).join('\n'));
  },

  async click([x, y, button]) {
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {
      throw new Error('Usage: screen-sense.mjs click <x> <y> [left|right]');
    }
    console.log(JSON.stringify(await runPowerShell(['click', String(x), String(y), button ?? 'left'])));
  },

  async type(args) {
    // Taken from stdin so that punctuation, newlines and quotes survive intact —
    // this is how a form gets filled, and a form is full of all three.
    const text = args.join(' ');
    const input = text.length > 0 ? text : await readStdin();
    console.log(JSON.stringify(await runPowerShell(['type'], input)));
  },

  async keys([combination]) {
    if (!combination) throw new Error('Usage: screen-sense.mjs keys "^s"');
    console.log(JSON.stringify(await runPowerShell(['keys', combination])));
  },

  async focus([title]) {
    if (!title) throw new Error('Usage: screen-sense.mjs focus "<window title>"');
    console.log(JSON.stringify(await runPowerShell(['focus', title])));
  },
};

const readStdin = () =>
  new Promise((done) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (input += chunk));
    process.stdin.on('end', () => done(input));
  });

/**
 * Exported so the shapes this has to tolerate can be tested without a screen.
 *
 * The bug worth a test here lived in the seam between the two scripts rather
 * than inside either, and the only way to pin it is to hand `describe` the shape
 * PowerShell actually produces.
 */
export { asList, describe };

// Only when run as a command, so importing it for a test does not read argv.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').at(-1))) {
  const [command, ...args] = process.argv.slice(2);
  const handler = commands[command];
  if (!handler) {
    console.error(
      'Commands: look [--text] [--limit=N] [--json], read, click <x> <y>, type, keys <combo>, focus <title>'
    );
    process.exit(1);
  }

  try {
    await handler(args);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
