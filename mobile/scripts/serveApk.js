#!/usr/bin/env node
/**
 * Serves the most recent APK over the local network so a phone can install it
 * from its browser, with no cable and no developer mode.
 *
 * Usage:
 *   node scripts/serveApk.js            serve the newest build-*.apk
 *   node scripts/serveApk.js --port N   listen on a different port
 *   node scripts/serveApk.js <file>     serve a specific APK
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const MOBILE_ROOT = path.join(__dirname, '..');
const DEFAULT_PORT = 8765;
const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex === -1 ? DEFAULT_PORT : Number(args[portIndex + 1]);
const explicitFile = args.find((arg) => arg.endsWith('.apk'));

/** The newest build-*.apk, so a fresh build is served without naming it. */
function newestApk() {
  const candidates = fs
    .readdirSync(MOBILE_ROOT)
    .filter((name) => name.startsWith('build-') && name.endsWith('.apk'))
    .map((name) => path.join(MOBILE_ROOT, name))
    .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  return candidates.length > 0 ? candidates[0].file : null;
}

/**
 * The addresses a phone on the same Wi-Fi can actually reach.
 *
 * Link-local addresses are excluded: an interface that failed to get a lease
 * still reports a 169.254 address, it looks like a perfectly good LAN address,
 * and nothing on the network can reach it.
 */
function lanAddresses() {
  const addresses = [];

  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue;
      addresses.push({ name, address: entry.address });
    }
  }

  // Private ranges first: a VPN or virtual adapter often sits on a public-looking
  // address the phone has no route to.
  const isPrivate = (address) =>
    address.startsWith('192.168.') ||
    address.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address);

  return addresses.sort((a, b) => Number(isPrivate(b.address)) - Number(isPrivate(a.address)));
}

function page(fileName, sizeMb) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Fool Mobile</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 2rem 1.5rem;
         background: #000; color: #fff; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  p { color: #999; font-size: 0.95rem; margin: 0 0 1.5rem; }
  a { display: block; text-align: center; padding: 1rem; border-radius: 0.75rem;
      background: #fff; color: #000; text-decoration: none; font-weight: 600; }
</style>
</head>
<body>
  <h1>The Fool Mobile</h1>
  <p>${fileName} &middot; ${sizeMb} MB</p>
  <a href="/app.apk">Download and install</a>
</body>
</html>
`;
}

function main() {
  const apk = explicitFile ? path.resolve(explicitFile) : newestApk();

  if (!apk || !fs.existsSync(apk)) {
    console.error('\nNo APK found. Build one first:\n  npm run apk\n');
    process.exit(1);
  }

  const fileName = path.basename(apk);
  const sizeMb = (fs.statSync(apk).size / (1024 * 1024)).toFixed(1);

  const server = http.createServer((request, response) => {
    if (request.url === '/app.apk') {
      // Content-Disposition keeps the browser from rendering the bytes.
      response.writeHead(200, {
        'Content-Type': APK_CONTENT_TYPE,
        'Content-Length': fs.statSync(apk).size,
        'Content-Disposition': `attachment; filename="${fileName}"`,
      });
      fs.createReadStream(apk).pipe(response);
      return;
    }

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(page(fileName, sizeMb));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`\nServing ${fileName} (${sizeMb} MB)\n`);
    const addresses = lanAddresses();

    if (addresses.length === 0) {
      console.log('  No reachable network address found. Is Wi-Fi connected?');
    }

    for (const { name, address } of addresses) {
      console.log(`  http://${address}:${port}    (${name})`);
    }

    console.log('\nOpen one of these on the phone. Android will ask permission to');
    console.log('install from the browser; that permission is per-app and can be');
    console.log('revoked afterwards. Press Ctrl+C to stop serving.\n');
  });
}

main();
