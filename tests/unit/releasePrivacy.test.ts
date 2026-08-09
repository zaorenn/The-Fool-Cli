/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Nothing about the machine that built it ships in the download.
 *
 * This exists because it happened. A tool description written during
 * development used the developer's own home directory as its example, which
 * meant two things at once: their username inside a public installer, and every
 * user's assistant being told that *their* desktop was at somebody else's path.
 *
 * It was caught by scanning the built package by hand, minutes before
 * publishing. This is that scan, moved to where it runs every time rather than
 * when somebody remembers to look.
 *
 * ## Why it checks for *this* machine's user and not for home directories
 *
 * The first version refused any `C:\Users\<name>` and immediately found
 * thirteen — all of them deliberate, localised placeholders in the settings
 * copy: `C:\Users\me`, `C:\Users\ich`, `C:\Users\moi`. Those are documentation
 * doing its job.
 *
 * A check that cannot tell a placeholder from a leak gets suppressed, and a
 * suppressed check finds nothing. So it asks the question that actually
 * matters — is the name of whoever built this in the build? — which works on
 * anybody's machine rather than being hard-coded to one developer.
 *
 * ## Why it looks for the name *inside a path*
 *
 * The version before this looked for the name as a bare word anywhere, and
 * claimed in this comment to have no false positives. It had one, and it was
 * fatal: on GitHub the build user is called `runner`, so the scan matched
 * `toolRunner.ts`, `runAgentTask` and every sentence containing the word — and
 * the release job failed on every tag while the app was fine. The same would
 * happen to a developer called `max`, `sam`, `test` or `admin`.
 *
 * A leak is not the name; it is the name in a *home directory*. That is what
 * happened, that is what is worth failing a release over, and it cannot be
 * matched by accident.
 */

/*
 * Resolved from the working directory, the way the other asset checks here do.
 * `__dirname` is `tests/unit`, and walking up from it is exactly the slip that
 * made the first version read zero files and pass — a privacy check that
 * silently checks nothing is worse than no check at all.
 */
const ROOT = resolve('.');

/** Trees that end up in the shipped bundle. Tests are not downloaded by anybody. */
const SHIPPED = ['packages/desktop/src', 'packages/web-host/src', 'backend/core/crates/fool-app/assets'];

/** File types worth reading; anything else in these trees is not shipped text. */
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|css|html|ps1|rs)$/i;

const filesUnder = (directory: string): string[] => {
  try {
    return readdirSync(resolve(ROOT, directory), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && TEXT.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name));
  } catch {
    return [];
  }
};

const shippedFiles = SHIPPED.flatMap(filesUnder);

/** Whoever is building. Read rather than hard-coded, so this works for everyone. */
const buildUser = userInfo().username;

const escaped = buildUser.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The build user's name where a leak actually puts it: inside a home directory.
 *
 * Every shape the three platforms write one in, because the string that shipped
 * last time was a Windows path and the one baked into the backend by `file!()`
 * is a Unix one.
 */
const inAHomePath = new RegExp(String.raw`(?:[a-z]:[\\/]{1,2}users|[\\/]home|[\\/]users)[\\/]{1,2}${escaped}\b`, 'i');

/**
 * Whether this machine's user is an ordinary English word.
 *
 * Asked by scanning for it, which is the only honest way to know: if the name
 * turns up in source that has nothing to do with anybody's home directory, then
 * it is a word rather than an identifier, and any check that looks for it bare
 * is measuring the dictionary. `runner` is the case that proved it.
 */
const nameIsAnOrdinaryWord = (): boolean => {
  const bare = new RegExp(String.raw`\b${escaped}\b`, 'i');
  return shippedFiles.some((file) => bare.test(readFileSync(file, 'utf8')));
};

const scan = (pattern: RegExp): string[] =>
  shippedFiles.flatMap((file) => {
    const match = pattern.exec(readFileSync(file, 'utf8'));
    return match ? [`${file.replace(ROOT, '')}: ${match[0]}`] : [];
  });

describe('what ships in the download', () => {
  it('reads a meaningful number of files, so the checks below are not vacuous', () => {
    // The first version of this scanned the wrong directory and passed against
    // nothing. This is the assertion that would have caught that.
    expect(shippedFiles.length).toBeGreaterThan(200);
  });

  /**
   * The check that keeps the check honest.
   *
   * A privacy scan that has been loosened until it passes is worse than none,
   * so the pattern is asked directly whether it still recognises the thing that
   * actually shipped — and whether it has stopped recognising the word that
   * made it fail every release.
   */
  it('still recognises a leak, and no longer recognises a word', () => {
    const home = (name: string): RegExp =>
      new RegExp(String.raw`(?:[a-z]:[\\/]{1,2}users|[\\/]home|[\\/]users)[\\/]{1,2}${name}\b`, 'i');

    // The one that shipped, and the one `file!()` bakes into the backend.
    expect(home('sarhen').test(String.raw`C:\Users\sarhen\Desktop`)).toBe(true);
    expect(home('sarhen').test('C:/Users/sarhen/Desktop')).toBe(true);
    expect(home('runner').test('/home/runner/.cargo/registry/src/lib.rs')).toBe(true);
    expect(home('runner').test('/Users/runner/work/The-Fool-Cli')).toBe(true);

    // The four hits that failed every tag: the word, doing its job.
    expect(home('runner').test('import { runVoiceTool } from "./toolRunner";')).toBe(false);
    expect(home('runner').test('the runner reports each step')).toBe(false);
  });

  it('carries no home directory belonging to whoever built it', () => {
    expect(scan(inAHomePath), `the build machine's user (${buildUser}) in a path in shipped source`).toEqual([]);
  });

  it('carries no build-machine cache paths', () => {
    expect(scan(/\.electron-gyp|[\\/]\.cargo[\\/]registry/i)).toEqual([]);
  });

  /**
   * The second half of the same mistake, and the more damaging one. A path in a
   * tool description is not only a privacy problem — it is an instruction, and
   * a model handed one applies it confidently to a user it has never met.
   */
  /**
   * The half the source scan cannot see.
   *
   * `file!()` bakes an absolute source path into every panic message and every
   * `#[track_caller]` site, and most of those paths point into the Cargo
   * registry under the builder's home directory. The check above reads source
   * text and found nothing wrong, while the binary beside it carried the
   * builder's account name 4,684 times — shipped to every install, read by
   * nothing.
   *
   * Skipped when no binary is staged. A developer who has not built the backend
   * is not the person this is protecting against, and failing their test run
   * for it teaches them to ignore this file.
   *
   * Skipped too when the build user's name is an ordinary English word, proved
   * by finding it in shipped source that has nothing to do with a home
   * directory. A megabyte of compiled text contains most short words, so for a
   * user called `runner` this would be measuring the dictionary rather than the
   * binary. The source check above still applies to them, because a path cannot
   * be matched by accident.
   */
  it('carries no trace of whoever built it in the compiled backend', () => {
    const binary = resolve(ROOT, 'resources/bundled-foolcore/win32-x64/foolcore.exe');
    if (!existsSync(binary) || nameIsAnOrdinaryWord()) return;

    const compiled = readFileSync(binary);

    expect(
      compiled.includes(Buffer.from(buildUser, 'latin1')),
      `the build machine's user (${buildUser}) in foolcore.exe`
    ).toBe(false);
  });

  it('gives the model no example path to mistake for the user’s own', () => {
    const tools = readFileSync(resolve(ROOT, 'packages/desktop/src/common/realtime/index.ts'), 'utf8');

    expect(tools).not.toMatch(/C:[\\/]{1,2}Users[\\/]{1,2}[A-Za-z]/);
  });
});
