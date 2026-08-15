/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Office half of this product used to depend on a network fetch.
 *
 * `irm https://d.officecli.ai/install.ps1 | iex` ran the first time anybody
 * previewed a Word document — unpinned, unverified, and useless offline. Ten
 * builtin skills and six assistants meanwhile described Word, Excel and
 * PowerPoint editing to the model as things it could do, and whether that was
 * true depended on something nobody could see.
 *
 * These hold the replacement in place: a pinned version, a recorded checksum
 * per platform, an Apache-2.0 attribution for a binary that is now
 * redistributed rather than fetched, and a server that is only registered when
 * the binary is really there.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  officecliCandidates,
  officeServerCommand,
  OFFICECLI_MCP_ARGS,
} from '@process/resources/builtinMcp/officeServerCommand';

const VENDOR = resolve('resources/officecli');
const read = (file: string): string => readFileSync(resolve(VENDOR, file), 'utf8');

describe('the vendored officecli', () => {
  it('pins one exact version rather than a tag that moves', () => {
    const version = read('OFFICECLI_VERSION').trim();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(version).not.toBe('latest');
  });

  it('records a checksum for every platform it ships', () => {
    const sums = read('SHA256SUMS');
    for (const asset of [
      'officecli-win-x64.exe',
      'officecli-win-arm64.exe',
      'officecli-mac-arm64',
      'officecli-mac-x64',
      'officecli-linux-x64',
      'officecli-linux-arm64',
    ]) {
      expect(sums).toContain(asset);
    }
    // Real digests, not placeholders.
    expect(sums.match(/^[0-9a-f]{64} \*/gmu)?.length).toBe(6);
  });

  it('keeps the binaries out of git while keeping the pin in it', () => {
    // The pin and the sums are what make the fetch reproducible and refusable;
    // 200MB of binaries in history are what make a clone unusable.
    const ignore = read('.gitignore');
    expect(ignore).toContain('*/');
    expect(existsSync(resolve(VENDOR, 'OFFICECLI_VERSION'))).toBe(true);
    expect(existsSync(resolve(VENDOR, 'SHA256SUMS'))).toBe(true);
  });

  it('carries the Apache-2.0 attribution a redistributed binary requires', () => {
    const notice = readFileSync(resolve('NOTICE'), 'utf8');
    const version = read('OFFICECLI_VERSION').trim();

    expect(notice).toContain(`OfficeCLI ${version}`);
    expect(notice).toContain('Apache License, Version 2.0');
    // It is shipped now, not fetched. The old wording said "installed on
    // demand", which was the thing being fixed.
    expect(notice).toContain('redistributes the following binary');
  });
});

describe('the fetch script', () => {
  const script = readFileSync(resolve('scripts/fetch-officecli.mjs'), 'utf8');

  it('refuses bytes that do not match the recorded checksum', () => {
    expect(script).toContain('Refusing to write it');
    expect(script).toContain("createHash('sha256')");
  });

  it('refuses an asset nobody has recorded a checksum for', () => {
    expect(script).toContain('has no recorded checksum');
  });

  it('will not accept a moving version', () => {
    expect(script).toContain('not a range or a tag like "latest"');
  });
});

describe('officeServerCommand', () => {
  it('starts the stdio server rather than registering with a client', () => {
    // Verified against the pinned binary's own help, not guessed from the
    // README: `officecli mcp` starts the server, and `officecli mcp <target>`
    // registers with a named client. A plausible-looking `['mcp', 'serve']`
    // would be read as a target called "serve".
    expect(OFFICECLI_MCP_ARGS).toEqual(['mcp']);
  });

  it('is not offered at all when this build carries no binary', () => {
    // A server in the user's list that cannot start is a tool list the model
    // reads and believes, and a failure it discovers mid-task.
    expect(officeServerCommand(undefined, resolve('does/not/exist'))).toBeNull();
  });

  it('looks where electron-builder puts it and where a dev run finds it', () => {
    const candidates = officecliCandidates('C:/app/resources', 'C:/repo', 'win32', 'x64');
    expect(candidates.some((path) => path.includes('resources') && path.endsWith('officecli.exe'))).toBe(true);
    expect(candidates.some((path) => path.includes('win-x64'))).toBe(true);
  });

  it('names the binary the way each platform does', () => {
    expect(officecliCandidates(undefined, '/repo', 'darwin', 'arm64').every((path) => path.endsWith('officecli'))).toBe(
      true
    );
    expect(
      officecliCandidates(undefined, 'C:/repo', 'win32', 'x64').every((path) => path.endsWith('officecli.exe'))
    ).toBe(true);
  });
});
