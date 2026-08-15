/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which command actually runs when an application is opened by name.
 *
 * The pure half of this — folding a name, scoring a match — is covered in
 * `appLaunch.test.ts`. What is covered here is the half that was wrong on a
 * real machine and right in every test: `Get-StartApps` returns two shapes of
 * `AppID`, and the rewrite that made app launching cross-platform handled only
 * one of them. Every game installed outside a store is listed as a path, and a
 * path handed to `shell:AppsFolder\…` opens nothing and reports no error.
 *
 * So the boundary mocked here is `execFile` — the operating system — and
 * nothing else. The assertion is on the argv that reached it, because that is
 * the thing that was wrong: a test that stubbed `startIndexed` would have
 * agreed with the bug.
 */

const execFileMock = vi.hoisted(() => vi.fn());
const installedAppsMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: (file: string, args: string[], options: unknown, done: (error: Error | null) => void) => {
    execFileMock(file, args);
    done(null);
    return undefined;
  },
}));

vi.mock('@process/services/apps/appIndex', () => ({ installedApps: installedAppsMock }));

const asPlatform = (platform: string): void => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
};

describe('controlApp on Windows', () => {
  const realPlatform = process.platform;

  beforeEach(() => {
    execFileMock.mockClear();
    installedAppsMock.mockReset();
    asPlatform('win32');
  });

  afterEach(() => {
    asPlatform(realPlatform);
    vi.resetModules();
  });

  it('runs a Start-menu entry that is an executable path directly', async () => {
    installedAppsMock.mockResolvedValue([
      { name: 'Marvels Spider-Man 2', launchId: 'C:\\Games\\Marvels Spider-Man 2\\Spider-Man2.exe' },
    ]);

    const { controlApp } = await import('@process/services/apps/launchApp');
    const outcome = await controlApp('Spider-Man 2', 'open');

    expect(outcome).toEqual({ status: 'opened', name: 'Marvels Spider-Man 2' });
    expect(execFileMock).toHaveBeenCalledWith('C:\\Games\\Marvels Spider-Man 2\\Spider-Man2.exe', []);
    // The bug this file exists for: the path must not be pasted after
    // `shell:AppsFolder\`, which opens nothing and says nothing went wrong.
    const [[file, args]] = execFileMock.mock.calls;
    expect(`${file} ${args.join(' ')}`).not.toContain('AppsFolder');
  });

  it('still sends a real AppUserModelID through the applications folder', async () => {
    installedAppsMock.mockResolvedValue([
      { name: 'Xbox', launchId: 'Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App' },
    ]);

    const { controlApp } = await import('@process/services/apps/launchApp');
    const outcome = await controlApp('Xbox', 'open');

    expect(outcome).toEqual({ status: 'opened', name: 'Xbox' });
    expect(execFileMock).toHaveBeenCalledWith('explorer.exe', [
      'shell:AppsFolder\\Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App',
    ]);
  });

  it('does not treat a non-executable path as a program to run', async () => {
    installedAppsMock.mockResolvedValue([{ name: 'Notes', launchId: 'C:\\Users\\me\\notes.txt' }]);

    const { controlApp } = await import('@process/services/apps/launchApp');
    await controlApp('Notes', 'open');

    const [file] = execFileMock.mock.calls[0];
    expect(file).toBe('explorer.exe');
  });
});
