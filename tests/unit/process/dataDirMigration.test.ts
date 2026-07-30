/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module under test binds `renameSync` at import time, so intercepting it
// means replacing it in the module rather than spying on the namespace object.
const state = vi.hoisted(() => ({ renameFails: false }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: actual,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (state.renameFails) throw new Error('EBUSY: resource busy or locked');
      return actual.renameSync(...args);
    },
  };
});

const { DATA_DIR_NAME, LEGACY_DATA_DIR_NAME, resolveDataDir } = await import('@process/utils/utils');

/**
 * The folder holds the database, its write-ahead log, the conversations and the
 * agent sessions. Every case here is really the same question: can the app end
 * up pointing at an empty folder while the real one is still on disk? That is
 * what losing every conversation would look like from the outside.
 */
describe('resolveDataDir', () => {
  let root: string;

  beforeEach(() => {
    state.renameFails = false;
    root = mkdtempSync(path.join(tmpdir(), 'fool-data-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const legacyDir = () => path.join(root, LEGACY_DATA_DIR_NAME);
  const currentDir = () => path.join(root, DATA_DIR_NAME);

  const seed = (dir: string, contents: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'backend.db'), contents);
  };

  it('moves an old folder onto the current name, contents and all', () => {
    seed(legacyDir(), 'the conversations');

    expect(resolveDataDir(root)).toBe(currentDir());
    expect(readFileSync(path.join(currentDir(), 'backend.db'), 'utf8')).toBe('the conversations');
    expect(existsSync(legacyDir())).toBe(false);
  });

  it('leaves an installation that never had the old name alone', () => {
    expect(resolveDataDir(root)).toBe(currentDir());
  });

  // Both present means the move already happened and something recreated the old
  // folder. The current one is the live data; touching it would be the one way
  // to lose it.
  it('never overwrites the current folder with the old one', () => {
    seed(legacyDir(), 'stale');
    seed(currentDir(), 'live');

    expect(resolveDataDir(root)).toBe(currentDir());
    expect(readFileSync(path.join(currentDir(), 'backend.db'), 'utf8')).toBe('live');
  });

  // Windows holds a file lock on an open database, so a rename during a run
  // throws. Carrying on with the old folder keeps every conversation; creating a
  // fresh one under the new name would hide them all.
  it('keeps using the old folder when it cannot be moved', () => {
    seed(legacyDir(), 'the conversations');
    state.renameFails = true;

    expect(resolveDataDir(root)).toBe(legacyDir());
    expect(readFileSync(path.join(legacyDir(), 'backend.db'), 'utf8')).toBe('the conversations');
    expect(existsSync(currentDir())).toBe(false);
  });

  it('is a no-op the second time, so a restart cannot move anything twice', () => {
    seed(legacyDir(), 'the conversations');

    expect(resolveDataDir(root)).toBe(currentDir());
    expect(resolveDataDir(root)).toBe(currentDir());
    expect(readFileSync(path.join(currentDir(), 'backend.db'), 'utf8')).toBe('the conversations');
  });
});
