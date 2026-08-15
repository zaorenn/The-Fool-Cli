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

/* -------------------------------------------------------------- discovery -- */

/**
 * Finding the application somebody named, rather than hoping the name is a
 * command.
 *
 * The commands above are the whole of what "open Spotify" used to do, and on
 * Windows that is `start "" Spotify` — which only resolves a name the system
 * already knows as a command, through `App Paths` or `PATH`. Measured on a real
 * machine: Spotify and notepad opened, **Discord and Steam did not**, because
 * both install per-user and neither registers a command. There was no second
 * attempt and no lookup; the request simply failed, and the assistant said so
 * about an application sitting in the user's own Start menu.
 *
 * Every desktop already keeps a list of its installed applications — the Start
 * menu, `/Applications`, the `.desktop` files. What was missing was reading it.
 * So the launch is now: resolve the spoken name against that list, and launch
 * the entry it identifies. The command path above stays as the fallback for a
 * name the list does not have.
 *
 * This half is the resolution, kept pure. It is the part with the interesting
 * failure — a person says "spotifayı aç", and the model hands over `Spotify'ı`.
 */

/** One application the operating system says is installed. */
export type IndexedApp = {
  /** What the list calls it, which is what will be said back to the user. */
  name: string;
  /**
   * What to hand the platform to start it.
   *
   * Opaque on purpose and never parsed here: on Windows it is a Start-menu
   * AppID, on macOS a bundle path, on Linux a `.desktop` id. What builds it
   * knows what it means; this file only carries it.
   */
  launchId: string;
};

/**
 * Letters that mean the same thing to a person and different things to a
 * comparison.
 *
 * Turkish first because that is the language this is used in most: `İ`
 * lowercases to a dotted i with a combining mark, `ı` is a distinct letter from
 * `i`, and the ordinary `toLowerCase` gets both wrong in a way that makes
 * `IŞIK` and `ışık` unequal. The rest are the accents that appear in
 * application names in the other languages the app ships in.
 */
const FOLDED: Readonly<Record<string, string>> = {
  ı: 'i',
  İ: 'i',
  I: 'i',
  ş: 's',
  Ş: 's',
  ğ: 'g',
  Ğ: 'g',
  ü: 'u',
  Ü: 'u',
  ö: 'o',
  Ö: 'o',
  ç: 'c',
  Ç: 'c',
};

/**
 * The suffix a Turkish speaker puts on the name of the thing they are acting on.
 *
 * "Spotify'ı aç", "Discord'u kapat", "Steam'i başlat". The transcript keeps the
 * apostrophe, the model passes the whole word through as the name, and a
 * comparison against `Spotify` then fails on a word that is unmistakably
 * Spotify. Only what follows an apostrophe is removed, and only when it is short
 * — so `Assassin's Creed` keeps its `s`.
 */
const TURKISH_SUFFIX = /['’](?:y?[ıiuü]|[ıiuü]?n[ıiuü]?|[dt][aeıi]|l[ae]r?[ıi]?)$/;

/**
 * A name reduced to what two people would agree it is.
 *
 * Everything that is punctuation, spacing or case disappears; what is left is
 * letters and digits separated by single spaces.
 */
export const foldAppName = (name: string): string =>
  name
    .trim()
    .replace(TURKISH_SUFFIX, '')
    .replace(/[ıİIşŞğĞüÜöÖçÇ]/g, (character) => FOLDED[character] ?? character)
    .toLowerCase()
    // Everything else with an accent on it, via the decomposition.
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** The words of a folded name, for the partial comparisons. */
const wordsOf = (folded: string): string[] => (folded.length === 0 ? [] : folded.split(' '));

/**
 * How well an entry answers what was said, from 0 to 1.
 *
 * Ordered by how sure each kind of agreement makes us, rather than by a single
 * distance: "steam" against `Steam` and against `Steam Support Center` are both
 * prefix matches, and the only thing that separates them is that one of them is
 * the whole name. Which is exactly the judgement a person makes.
 */
export const scoreAppMatch = (spoken: string, appName: string): number => {
  const query = foldAppName(spoken);
  const name = foldAppName(appName);
  if (query.length === 0 || name.length === 0) return 0;

  if (query === name) return 1;

  // The name begins with what was said. The rest of it counts against the
  // score, so the shortest name that starts this way wins — `Steam` over
  // `Steam Support Center`.
  if (name.startsWith(query)) return 0.9 - Math.min(0.25, (name.length - query.length) / 100);

  // Said more than the name has: "visual studio code editor" against
  // `Visual Studio Code`. Still that application, said generously.
  if (query.startsWith(name)) return 0.82;

  const queryWords = wordsOf(query);
  const nameWords = new Set(wordsOf(name));

  // Every word said appears in the name: "code visual studio", or a name whose
  // words the speaker reordered.
  if (queryWords.length > 0 && queryWords.every((word) => nameWords.has(word))) return 0.74;

  if (name.includes(query)) return 0.66;

  // Whatever the two have in common, which is the only thing left that can
  // separate a near miss from a wrong answer.
  const shared = queryWords.filter((word) => nameWords.has(word)).length;
  if (shared === 0) return 0;
  return 0.6 * (shared / Math.max(queryWords.length, nameWords.size));
};

/**
 * How sure the match has to be before the application is opened.
 *
 * This decides something on the user's own machine, so the failure to avoid is
 * opening the wrong program rather than opening nothing: "I could not find it"
 * is a recoverable sentence and a stranger's window appearing is not. Set just
 * below the whole-word agreements above, so a partial word overlap alone is
 * never enough.
 */
export const APP_MATCH_FLOOR = 0.62;

/**
 * The entry somebody meant, or nothing when the list does not obviously have it.
 *
 * Ties break towards the shorter name for the reason given on the prefix rule,
 * and towards the first listed after that so the answer does not depend on the
 * order the platform happened to enumerate in.
 */
export const findApp = (spoken: string, apps: readonly IndexedApp[]): IndexedApp | null => {
  let best: IndexedApp | null = null;
  let bestScore = 0;

  for (const app of apps) {
    const score = scoreAppMatch(spoken, app.name);
    if (score < APP_MATCH_FLOOR) continue;
    if (score > bestScore || (score === bestScore && best !== null && app.name.length < best.name.length)) {
      best = app;
      bestScore = score;
    }
  }

  return best;
};

/**
 * Whether a name may be looked up in the index.
 *
 * Deliberately wider than {@link isLaunchableAppName}, and safely so: that one
 * guards a string that becomes an argument to a program the system will run,
 * where a closed character set is the whole defence. Nothing here reaches a
 * command — a name is compared against a list the operating system wrote, and
 * what gets launched is the list's own id. So the apostrophe in `Spotify'ı` and
 * the `+` in `Notepad++` are allowed here and still refused there.
 */
export const isSearchableAppName = (name: string): boolean => {
  const wanted = name.trim();
  return wanted.length > 0 && wanted.length <= 80 && !/[\r\n\t]/.test(wanted);
};

/**
 * A Start-menu id that is already a path to a program.
 *
 * `Get-StartApps` returns two shapes of `AppID` and only one of them is an
 * AppUserModelID. Half the menu is a path, and games installed outside a store
 * are almost all of it: `Marvels Spider-Man 2` is listed as
 * `C:\Games\Marvels Spider-Man 2\Spider-Man2.exe`. Handing that to
 * `shell:AppsFolder\…` opens nothing at all, so an installed game sitting in
 * the user's own Start menu was unopenable by name — found by the user, not by
 * a test.
 *
 * Refused unless it is an absolute path on a drive ending in `.exe`. The value
 * comes from the operating system rather than from a model, but it is about to
 * become a program that runs, and a rule that holds only while the source is
 * trusted breaks the first time something else is passed to it. `execFile`
 * takes it as a file and an argument list, never a shell string, so a space in
 * `Program Files` needs no quoting and no quoting can be escaped out of.
 */
const EXECUTABLE_PATH = /^[a-z]:\\(?:[^<>:"|?*\r\n]+\\)*[^<>:"|?*\r\n]+\.exe$/i;

export const executablePathCommand = (launchId: string): AppLaunchCommand | null => {
  const wanted = launchId.trim();
  if (!EXECUTABLE_PATH.test(wanted)) return null;
  return { file: wanted, args: [] };
};
