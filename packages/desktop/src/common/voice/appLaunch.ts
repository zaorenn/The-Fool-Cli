/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Starting and stopping an application, without a pointer.
 *
 * The same defect as playing a song, one step along. "Open Spotify" and "close
 * Discord" were handed to the agent, which drove the desktop to do them: find
 * the taskbar, find the icon, click, screenshot, find the window's close button,
 * click again. Every operating system this app runs on will do both from a
 * single call, and doing it that way means the user's cursor stays theirs.
 *
 * What lives here is the part with no process in it — whether a name may be
 * used at all, and what command it becomes on each platform. Kept pure because
 * this is the half with the interesting failure mode: **every character of the
 * name was written by a language model**, and the command it lands in is a
 * program the system will run.
 *
 * The name is therefore validated rather than escaped. Escaping is a promise
 * about somebody else's parser — `cmd`'s, PowerShell's, AppleScript's — and
 * those parsers disagree with each other about what a quote means. A closed set
 * of characters cannot be talked into a second command by any of them.
 */

/** Which way an application is being moved. */
export type AppLaunchAction = 'open' | 'close';

/** A program to run and its arguments, already separated. Never a shell string. */
export type AppLaunchCommand = { file: string; args: readonly string[] };

/**
 * The only names that may be used.
 *
 * Letters, digits, spaces and the three punctuation marks that appear in real
 * application names — `Visual Studio Code`, `1Password`, `pgAdmin 4`,
 * `node-red`. Everything a shell would find interesting is outside the set:
 * quotes, `&`, `|`, `;`, `$`, backticks, newlines, slashes and backslashes.
 *
 * Paths are refused too, and on purpose. This is "open the app called X"; a
 * request to open a *file* at a path is a different tool with a different
 * permission story, and letting one become the other by writing a slash is how
 * "open my music app" turns into running something out of a temp directory.
 */
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}$/u;

/**
 * Whether this is a name an application may be looked up by.
 *
 * Exported because the refusal has to happen before the request leaves the
 * renderer as well as before the command is built: a name that will be refused
 * should be refused where there is somebody to tell.
 */
export const isLaunchableAppName = (name: string): boolean => NAME.test(name.trim());

/** `Spotify` → `spotify.exe`, which is what Windows wants for stopping one. */
const windowsImage = (name: string): string => (/\.exe$/i.test(name) ? name : `${name}.exe`);

/**
 * The command for one action on one platform, or nothing when there is none.
 *
 * `null` for a name that failed validation, and for a platform this has not been
 * taught — answered as "there is no command" rather than as a guess, because a
 * guessed command still runs.
 */
export const launchCommandFor = (
  platform: NodeJS.Platform,
  action: AppLaunchAction,
  name: string
): AppLaunchCommand | null => {
  const wanted = name.trim();
  if (!isLaunchableAppName(wanted)) return null;

  if (platform === 'win32') {
    // `start` is a `cmd` builtin, so `cmd /c` is the only way to reach it. The
    // empty string is `start`'s title argument: without it, a quoted name is
    // taken as the window title and nothing launches.
    if (action === 'open') return { file: 'cmd', args: ['/c', 'start', '', wanted] };
    // `/T` takes the process tree with it — an application whose window is a
    // child of a launcher survives a bare `taskkill` and looks like nothing
    // happened. No `/F`: asked to close, an application should be allowed to
    // ask about unsaved work rather than lose it.
    return { file: 'taskkill', args: ['/IM', windowsImage(wanted), '/T'] };
  }

  if (platform === 'darwin') {
    if (action === 'open') return { file: 'open', args: ['-a', wanted] };
    // `quit` rather than a kill, for the same reason `/F` is left out above.
    // The name cannot contain a quote, so this cannot close the string early.
    return { file: 'osascript', args: ['-e', `quit app "${wanted}"`] };
  }

  if (platform === 'linux') {
    // No `-a`, no shell: the name is the program, looked up on PATH by `execFile`
    // itself. `gtk-launch` would take a .desktop id, which is not what a person
    // says out loud.
    if (action === 'open') return { file: wanted, args: [] };
    return { file: 'pkill', args: ['-x', wanted] };
  }

  return null;
};
