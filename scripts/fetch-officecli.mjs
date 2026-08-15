#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fetches the pinned officecli binary this application ships with.
 *
 * What this replaces: the application used to run `irm https://…/install.ps1 |
 * iex` on Windows, and the equivalent `curl … | bash` elsewhere, the first time
 * anybody previewed a Word document. Nothing was pinned, nothing was verified,
 * and it did not work offline — so the Office half of the product was a
 * capability that might or might not exist on a given machine, while ten builtin
 * skills described it to the model as something it could do.
 *
 * OfficeCLI is Apache-2.0 and publishes self-contained native binaries, so it
 * can simply be shipped. This runs at build time, on a machine somebody is
 * watching, and it refuses rather than proceeds when the bytes are not the ones
 * that were pinned.
 *
 * Usage:
 *   node scripts/fetch-officecli.mjs                # this platform
 *   node scripts/fetch-officecli.mjs --all          # every platform, for CI
 *   node scripts/fetch-officecli.mjs --record       # write SHA256SUMS afresh
 *
 * `--record` is for bumping the pin: run it once, read the diff, and commit the
 * new sums deliberately. It is not part of a build.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'resources', 'officecli');
const VERSION_FILE = path.join(VENDOR, 'OFFICECLI_VERSION');
const SUMS_FILE = path.join(VENDOR, 'SHA256SUMS');

/** Asset name per platform folder, as published on the release. */
const ASSETS = {
  'win-x64': 'officecli-win-x64.exe',
  'win-arm64': 'officecli-win-arm64.exe',
  'mac-arm64': 'officecli-mac-arm64',
  'mac-x64': 'officecli-mac-x64',
  'linux-x64': 'officecli-linux-x64',
  'linux-arm64': 'officecli-linux-arm64',
};

const binaryName = (target) => (target.startsWith('win-') ? 'officecli.exe' : 'officecli');

const currentTarget = () => {
  const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  return `${platform}-${process.arch}`;
};

const readVersion = () => {
  if (!existsSync(VERSION_FILE)) {
    throw new Error(`No pinned version. Write one to ${VERSION_FILE} first — a build must not choose its own.`);
  }
  const version = readFileSync(VERSION_FILE, 'utf8').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`"${version}" is not a version. Pin an exact one, not a range or a tag like "latest".`);
  }
  return version;
};

const readSums = () => {
  if (!existsSync(SUMS_FILE)) return {};
  const sums = {};
  for (const line of readFileSync(SUMS_FILE, 'utf8').split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (match) sums[match[2]] = match[1];
  }
  return sums;
};

const download = async (version, asset) => {
  const url = `https://github.com/iOfficeAI/OfficeCli/releases/download/v${version}/${asset}`;
  process.stdout.write(`  fetching ${url}\n`);

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${asset}: the release answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};

const main = async () => {
  const record = process.argv.includes('--record');
  const all = process.argv.includes('--all') || record;
  const version = readVersion();
  const pinned = readSums();
  const targets = all ? Object.keys(ASSETS) : [currentTarget()];

  process.stdout.write(`officecli v${version}\n`);

  const recorded = {};
  for (const target of targets) {
    const asset = ASSETS[target];
    if (!asset) {
      process.stdout.write(`  ${target}: no published binary; skipped\n`);
      continue;
    }

    const bytes = await download(version, asset);
    const digest = createHash('sha256').update(bytes).digest('hex');

    if (record) {
      recorded[asset] = digest;
    } else {
      const expected = pinned[asset];
      if (!expected) {
        throw new Error(
          `${asset} has no recorded checksum. Run with --record and commit the result; a build must not accept ` +
            `bytes nobody has looked at.`
        );
      }
      if (expected !== digest) {
        // Refused rather than warned. The whole reason this script exists is
        // that the previous arrangement executed whatever the network served.
        throw new Error(`${asset}: expected sha256 ${expected}, got ${digest}. Refusing to write it.`);
      }
    }

    const folder = path.join(VENDOR, target);
    mkdirSync(folder, { recursive: true });
    const out = path.join(folder, binaryName(target));
    writeFileSync(out, bytes, { mode: 0o755 });
    process.stdout.write(`  ${target}: ${bytes.length} bytes -> ${path.relative(ROOT, out)}\n`);
  }

  if (record) {
    const lines = Object.entries(recorded)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([asset, digest]) => `${digest} *${asset}`);
    writeFileSync(SUMS_FILE, `${lines.join('\n')}\n`, 'utf8');
    process.stdout.write(`\nRecorded ${lines.length} checksums to ${path.relative(ROOT, SUMS_FILE)}.\n`);
    process.stdout.write('Read the diff before committing: these are what every later build is checked against.\n');
  }
};

main().catch((error) => {
  process.stderr.write(`fetch-officecli failed: ${error.message}\n`);
  process.exit(1);
});
