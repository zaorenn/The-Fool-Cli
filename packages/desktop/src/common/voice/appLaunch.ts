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

/**
 * One entry of the Start menu, as the operating system lists it.
 *
 * `appId` is an AppUserModelID for a Store application —
 * `Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App` — and a path for a
 * desktop one. Only the first kind needs {@link appsFolderCommand}.
 */
export type StartMenuApp = { name: string; appId: string };

/** Punctuation and spacing folded away, so "XBOX" and "Xbox" are one name. */
const normalise = (text: string): string =>
  text
    .toLocaleLowerCase('tr-TR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * The installed application a spoken name refers to, or nothing.
 *
 * Measured before this existed: `cmd /c start "" "XBOX"` — what
 * {@link launchCommandFor} produces for an installed Store app — launched
 * nothing and did not return, because `start` resolves through PATH and App
 * Paths and a Store app is in neither. The name has to be turned into an
 * AppUserModelID first, and only the Start menu knows them.
 *
 * Matching is deliberately conservative, in this order:
 *
 * 1. the same name, ignoring case and punctuation;
 * 2. an entry that begins with every word of what was said — "Forza Horizon 6"
 *    finding "Forza Horizon 6 Standard Edition", because nobody says the
 *    edition out loud.
 *
 * A fragment of a word is never a match. Starting the wrong application is
 * worse than starting none: the user asked for one thing, watched another
 * open, and now distrusts every launch after it.
 */
export const bestStartMenuMatch = (spoken: string, installed: readonly StartMenuApp[]): StartMenuApp | null => {
  const wanted = normalise(spoken);
  if (wanted.length === 0) return null;

  const exact = installed.find((app) => normalise(app.name) === wanted);
  if (exact) return exact;

  // Word-boundary prefix rather than `includes`, so "For" cannot reach "Forza".
  const prefix = installed.find((app) => {
    const name = normalise(app.name);
    return name === wanted || name.startsWith(`${wanted} `);
  });
  return prefix ?? null;
};

/**
 * Only what an AppUserModelID is allowed to contain.
 *
 * The id comes from the operating system rather than from a language model, so
 * this is a narrower risk than {@link NAME} guards — but it still lands in a
 * command line, and a rule that holds only while the source is trusted is a
 * rule that breaks the first time somebody passes it something else.
 */
const APP_ID = /^[\p{L}\p{N}][\p{L}\p{N}._!+-]{0,127}$/u;

/**
 * The command that starts a Store application.
 *
 * `explorer.exe shell:AppsFolder\<id>` is the documented route and the only one
 * measured to work here; `start` does not resolve these at all. Explorer
 * returns immediately whatever happens, so its exit code says nothing about
 * whether the application came up — which is why the caller must not read
 * success out of it.
 */
export const appsFolderCommand = (appId: string): AppLaunchCommand | null => {
  const wanted = appId.trim();
  if (!APP_ID.test(wanted)) return null;
  return { file: 'explorer.exe', args: [`shell:AppsFolder\\${wanted}`] };
};

/**
 * A Start-menu id that is already a path to a program.
 *
 * Half the Start menu is this rather than an AppUserModelID, and games
 * installed outside a store are almost all of it: `Marvels Spider-Man 2` is
 * listed as `C:\Games\Marvels Spider-Man 2\Spider-Man2.exe`. Neither route
 * written before this reaches one — `start` cannot resolve the display name,
 * and AppsFolder takes an id this is not — so an installed game sitting in the
 * user's own Start menu was unopenable by name.
 *
 * Refused unless it is an absolute path on a drive ending in `.exe`. The value
 * comes from the operating system rather than from a model, but it is about to
 * become a program that runs, and a rule that holds only while the source is
 * trusted breaks the first time something else is passed to it. `execFile`
 * takes it as a file and an argument list, never a shell string, so a space in
 * `Program Files` needs no quoting and no quoting can be escaped out of.
 */
const EXECUTABLE_PATH = /^[a-z]:\\(?:[^<>:"|?*\r\n]+\\)*[^<>:"|?*\r\n]+\.exe$/i;

export const executablePathCommand = (appId: string): AppLaunchCommand | null => {
  const wanted = appId.trim();
  if (!EXECUTABLE_PATH.test(wanted)) return null;
  return { file: wanted, args: [] };
};
