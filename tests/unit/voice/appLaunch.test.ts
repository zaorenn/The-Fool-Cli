/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  findApp,
  foldAppName,
  isLaunchableAppName,
  isSearchableAppName,
  launchCommandFor,
  type IndexedApp,
} from '@/common/voice/appLaunch';

/**
 * Starting and stopping an application without borrowing the user's pointer.
 *
 * The same defect as playing a song, one step along: "open Spotify" was being
 * answered by finding the taskbar, finding the icon, clicking it and taking a
 * screenshot to see whether it had worked. Every platform does it in one call.
 *
 * The half worth testing is the half with no process in it, because that is the
 * half with the interesting failure mode: every character of the name was
 * written by a language model, and the command it lands in is a program the
 * system will run.
 */
describe('isLaunchableAppName', () => {
  it('accepts the names real applications actually have', () => {
    for (const name of ['Spotify', 'Visual Studio Code', '1Password', 'pgAdmin 4', 'node-red', 'obs_studio']) {
      expect(isLaunchableAppName(name), name).toBe(true);
    }
  });

  /**
   * The set is closed rather than escaped, and this is why. Escaping is a
   * promise about somebody else's parser — `cmd`'s, PowerShell's,
   * AppleScript's — and those disagree with each other about what a quote
   * means. None of them can be talked into a second command by a name that
   * cannot contain the characters they argue about.
   */
  it('refuses anything a shell would find interesting', () => {
    for (const name of [
      'Spotify & calc',
      'Spotify; rm -rf /',
      'Spotify | more',
      'Spotify`whoami`',
      'Spotify$(id)',
      'Spotify"',
      "Spotify'",
      'Spotify\nnotepad',
    ]) {
      expect(isLaunchableAppName(name), name).toBe(false);
    }
  });

  /**
   * A path is a different request with a different permission story. Letting
   * one become the other by writing a slash is how "open my music app" turns
   * into running something out of a temp directory.
   */
  it('refuses a path rather than treating it as a name', () => {
    for (const name of ['C:\\Windows\\System32\\calc.exe', '/usr/bin/id', './payload', '..\\..\\evil']) {
      expect(isLaunchableAppName(name), name).toBe(false);
    }
  });

  it('refuses an empty name and an absurdly long one', () => {
    expect(isLaunchableAppName('')).toBe(false);
    expect(isLaunchableAppName('   ')).toBe(false);
    expect(isLaunchableAppName('a'.repeat(200))).toBe(false);
  });
});

describe('launchCommandFor', () => {
  it('opens and closes on Windows without a shell string', () => {
    // The empty argument is `start`'s title parameter: without it a quoted name
    // is taken as the window title and nothing launches.
    expect(launchCommandFor('win32', 'open', 'Spotify')).toEqual({
      file: 'cmd',
      args: ['/c', 'start', '', 'Spotify'],
    });
    // `/T` takes the process tree, so an application whose window is a child of
    // a launcher actually closes. No `/F`, so unsaved work can still be saved.
    expect(launchCommandFor('win32', 'close', 'Spotify')).toEqual({
      file: 'taskkill',
      args: ['/IM', 'Spotify.exe', '/T'],
    });
  });

  it('does not double the extension on Windows', () => {
    expect(launchCommandFor('win32', 'close', 'Spotify.exe')?.args).toEqual(['/IM', 'Spotify.exe', '/T']);
  });

  it('opens and quits on macOS', () => {
    expect(launchCommandFor('darwin', 'open', 'Spotify')).toEqual({ file: 'open', args: ['-a', 'Spotify'] });
    expect(launchCommandFor('darwin', 'close', 'Spotify')).toEqual({
      file: 'osascript',
      args: ['-e', 'quit app "Spotify"'],
    });
  });

  it('opens and kills by name on Linux', () => {
    expect(launchCommandFor('linux', 'open', 'spotify')).toEqual({ file: 'spotify', args: [] });
    expect(launchCommandFor('linux', 'close', 'spotify')).toEqual({ file: 'pkill', args: ['-x', 'spotify'] });
  });

  /**
   * The property this file exists for: a refused name never becomes a command
   * on any platform. A guessed command still runs, so the answer is `null`
   * rather than a best effort.
   */
  it('never builds a command from a name that failed validation', () => {
    const hostile = ['Spotify & calc', 'C:\\Windows\\System32\\calc.exe', '', 'a`id`'];

    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      for (const action of ['open', 'close'] as const) {
        for (const name of hostile) {
          expect(launchCommandFor(platform, action, name), `${platform}/${action}/${name}`).toBeNull();
        }
      }
    }
  });

  it('answers with nothing on a platform it has not been taught', () => {
    expect(launchCommandFor('aix', 'open', 'Spotify')).toBeNull();
  });

  /**
   * The arguments stay separated all the way out, so there is no string for a
   * shell to re-parse. `execFile` is what the caller uses, and this is the
   * shape that makes that safe rather than decorative.
   */
  it('keeps the name in its own argument, never concatenated into one', () => {
    const command = launchCommandFor('win32', 'open', 'Visual Studio Code');

    expect(command?.args).toContain('Visual Studio Code');
    expect(command?.file).toBe('cmd');
  });
});

/**
 * Finding the application somebody named.
 *
 * The command path above only ever resolved a name the system already knew as a
 * command. Measured on a real Windows machine: `start "" Spotify` and
 * `start "" notepad` opened; **`start "" Discord` and `start "" Steam` did
 * not**, because both install per-user and neither registers one. Both are in
 * that machine's Start menu, which nothing was reading.
 *
 * These are the cases that decide whether reading it helps.
 */
describe('findApp', () => {
  const installed: IndexedApp[] = [
    { name: 'Discord', launchId: 'com.squirrel.Discord.Discord' },
    { name: 'Steam', launchId: String.raw`{7C5A40EF}\Steam\Steam.exe` },
    { name: 'Steam Support Center', launchId: 'http://support.steampowered.com/' },
    { name: 'Spotify', launchId: 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify' },
    { name: 'Visual Studio Code', launchId: 'VSCode' },
    { name: 'Google Chrome', launchId: 'Chrome' },
    { name: 'Windows Terminal', launchId: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe!App' },
  ];

  it('finds the two the command path could not open', () => {
    expect(findApp('Discord', installed)?.launchId).toBe('com.squirrel.Discord.Discord');
    expect(findApp('Steam', installed)?.name).toBe('Steam');
  });

  /**
   * The whole name beats a longer name that merely starts the same way. Without
   * this, "open Steam" is as good a match for `Steam Support Center` — and
   * opening a support page instead of the game library is exactly the kind of
   * near miss that reads as the assistant not listening.
   */
  it('prefers the whole name over a longer one that starts with it', () => {
    expect(findApp('steam', installed)?.name).toBe('Steam');
  });

  it('matches how people actually say a name', () => {
    expect(findApp('vs code', installed)).toBeNull();
    expect(findApp('visual studio code', installed)?.name).toBe('Visual Studio Code');
    expect(findApp('chrome', installed)?.name).toBe('Google Chrome');
    expect(findApp('terminal', installed)?.name).toBe('Windows Terminal');
  });

  /**
   * A Turkish speaker says "Spotify'ı aç", and the transcript keeps the suffix.
   * The old rule refused the name outright — `isLaunchableAppName` has no
   * apostrophe in its set — so the request failed on a word that is
   * unmistakably Spotify.
   */
  it('reads a Turkish accusative as the name it is attached to', () => {
    expect(findApp("Spotify'ı", installed)?.name).toBe('Spotify');
    expect(findApp("Discord'u", installed)?.name).toBe('Discord');
    expect(findApp("Steam'i", installed)?.name).toBe('Steam');
  });

  it('folds the letters that only look different', () => {
    expect(foldAppName('İŞIK')).toBe('isik');
    expect(foldAppName('Ünlü Öğe')).toBe('unlu oge');
    // Not a suffix: the `s` belongs to the name.
    expect(foldAppName("Assassin's Creed")).toBe('assassin s creed');
  });

  /**
   * Opening the wrong program is worse than opening nothing: "I could not find
   * it" is a sentence the user can recover from, and a stranger's window
   * appearing on their screen is not.
   */
  it('answers with nothing rather than the nearest thing', () => {
    expect(findApp('Photoshop', installed)).toBeNull();
    expect(findApp('Blender', installed)).toBeNull();
    expect(findApp('', installed)).toBeNull();
  });

  it('answers with nothing when the index could not be built', () => {
    expect(findApp('Discord', [])).toBeNull();
  });
});

/**
 * Two rules, deliberately different widths.
 *
 * The strict one guards a string that becomes an argument to a program the
 * system will run. The wide one guards a string that is compared against a list
 * the operating system itself wrote — where what gets launched is the list's own
 * id, and nothing the model said reaches a command at all.
 */
describe('isSearchableAppName', () => {
  it('takes the names the strict rule has to refuse', () => {
    for (const name of ["Spotify'ı", 'Notepad++', 'Slack (work)']) {
      expect(isSearchableAppName(name), name).toBe(true);
      expect(isLaunchableAppName(name), name).toBe(false);
    }
  });

  it('still refuses what is not a name at all', () => {
    expect(isSearchableAppName('')).toBe(false);
    expect(isSearchableAppName('   ')).toBe(false);
    expect(isSearchableAppName('Spotify\nrm -rf /')).toBe(false);
    expect(isSearchableAppName('x'.repeat(200))).toBe(false);
  });
});
