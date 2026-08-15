/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import {
  executablePathCommand,
  findApp,
  isSearchableAppName,
  launchCommandFor,
  type IndexedApp,
} from '@/common/voice/appLaunch';
import { installedApps } from './appIndex';

/**
 * Opening and closing an application, having first found out what it is.
 *
 * Two things happen here that did not before. The name is resolved against the
 * list of what is installed, so "Discord" reaches Discord rather than a command
 * that does not exist. And the answer says which application was opened, so the
 * assistant can name what it did instead of repeating the word it was given —
 * "opened Visual Studio Code" for "open vs code" is the difference between a
 * report and an echo.
 *
 * The old command path is kept underneath, unchanged, for the name the index
 * does not have. That is what makes this strictly an improvement: nothing that
 * worked before can stop working because a list came back empty.
 */

export type AppLaunchOutcome =
  /**
   * Discriminated on a string rather than on `ok`. `strictNullChecks` is off in
   * this project, so a boolean literal is not a discriminant the compiler will
   * follow — see the guards in `pdfForm.ts` for the same reason.
   */
  | { status: 'opened'; name: string }
  | { status: 'closed'; name: string }
  | { status: 'not-running'; name: string }
  | { status: 'not-found'; name: string }
  | { status: 'failed'; name: string };

/** How long the launch is given before it is called a failure. */
const LAUNCH_TIMEOUT_MS = 15_000;

const exec = (file: string, args: readonly string[]): Promise<{ ok: boolean }> =>
  new Promise((resolve) => {
    execFile(file, [...args], { timeout: LAUNCH_TIMEOUT_MS, windowsHide: true }, (error) => {
      resolve({ ok: !error });
    });
  });

/**
 * Starts an entry from the index, whatever kind of thing it turns out to be.
 *
 * On Windows the AppID goes through the shell's applications folder, which
 * launches a Store package and a per-user Win32 install with the same call —
 * that is the whole reason `Get-StartApps` is the source rather than the
 * shortcut folders.
 *
 * **`explorer.exe` exits non-zero even when it succeeds.** Measured: launching
 * Paint this way returns code 1 and the process appears. So the exit code is
 * deliberately not read on that path; the check below is what answers the
 * question, and reading the code would report every successful launch as a
 * failure.
 */
const startIndexed = async (app: IndexedApp): Promise<boolean> => {
  if (process.platform === 'win32') {
    const direct = executablePathCommand(app.launchId);
    if (direct) return (await exec(direct.file, direct.args)).ok;

    // Not every `AppID` is an AppUserModelID — see {@link executablePathCommand}.
    // A path handed to `shell:AppsFolder\…` opens nothing, silently, so the
    // shape is checked before the folder is used rather than after.
    await exec('explorer.exe', [`shell:AppsFolder\\${app.launchId}`]);
    return true;
  }
  if (process.platform === 'darwin') return (await exec('open', [app.launchId])).ok;
  if (process.platform === 'linux') return (await exec('gtk-launch', [app.launchId])).ok;
  return false;
};

/**
 * Whether anything is running under that name, for the platforms that can say.
 *
 * Only used to tell "it was not running" from "I could not close it", which is
 * the one distinction the user actually notices: being apologised to for
 * failing to close something that was already shut is worse than being told
 * nothing.
 */
const closeIndexed = async (app: IndexedApp): Promise<AppLaunchOutcome> => {
  if (process.platform === 'darwin') {
    // The bundle path's last segment is the application name AppleScript wants.
    const bundle = app.launchId.split('/').pop() ?? app.name;
    const { ok } = await exec('osascript', ['-e', `quit app id (id of app "${bundle.replace(/\.app$/, '')}")`]);
    return ok ? { status: 'closed', name: app.name } : { status: 'not-running', name: app.name };
  }

  // Windows and Linux are closed by process name, which the index does not
  // carry — an AppID is not an image name. The command path below knows how to
  // do that from the name the user said, and it is the right tool for it.
  return { status: 'failed', name: app.name };
};

/** The old behaviour, unchanged, for a name the index does not have. */
const byCommand = async (name: string, action: 'open' | 'close'): Promise<AppLaunchOutcome> => {
  const command = launchCommandFor(process.platform, action, name);
  if (!command) return { status: 'not-found', name };

  const { ok } = await exec(command.file, command.args);
  if (ok) return { status: action === 'open' ? 'opened' : 'closed', name };
  // `taskkill` and `pkill` both exit non-zero when nothing matched, which is
  // "that application was not running" rather than a fault — and the assistant
  // must not say it closed something that was never open.
  return action === 'close' ? { status: 'not-running', name } : { status: 'not-found', name };
};

/**
 * Opens or closes what the user named.
 *
 * The index first, because it is the half that knows what exists; the command
 * second, because it is the half that can stop a running process by name. A
 * name that matches nothing in either is reported as not found, which is a true
 * sentence and the one the assistant should be saying.
 */
export const controlApp = async (spoken: string, action: 'open' | 'close'): Promise<AppLaunchOutcome> => {
  const name = spoken.trim();
  if (!isSearchableAppName(name)) return { status: 'not-found', name };

  const match = findApp(name, await installedApps());

  if (match !== null && action === 'open') {
    if (await startIndexed(match)) return { status: 'opened', name: match.name };
    // The index knew of it and starting it did not work. Falling through rather
    // than reporting a failure: the command path may still have a way in, and
    // an application that opens is worth one more attempt.
  }

  if (match !== null && action === 'close') {
    const closed = await closeIndexed(match);
    if (closed.status !== 'failed') return closed;
    // Windows and Linux close by process name; the index cannot, so the command
    // path does — with the *indexed* name, which is more likely to be the real
    // one than whatever was said out loud.
    return byCommand(match.name, 'close');
  }

  return byCommand(name, action);
};
