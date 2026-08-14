/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { appsFolderCommand, bestStartMenuMatch, isLaunchableAppName, launchCommandFor } from '@/common/voice/appLaunch';

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
 * Measured on Windows 11 before this existed: `cmd /c start "" "XBOX"` — the
 * command this module produced for an *installed* Store app — launched nothing
 * and never returned, while `explorer.exe shell:AppsFolder\<AUMID>` opened it
 * at once. `start` resolves through PATH and App Paths, and a Store app is in
 * neither.
 */
describe('finding a Store application by the name a person says', () => {
  const installed = [
    { name: 'XBOX', appId: 'Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App' },
    { name: 'Forza Horizon 6 Standard Edition', appId: 'Microsoft.SunriseBaseGame_8wekyb3d8bbwe!Game' },
    { name: 'Spotify', appId: 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify' },
  ];

  it('matches the name exactly, whatever the casing', () => {
    expect(bestStartMenuMatch('xbox', installed)?.appId).toContain('GamingApp');
    expect(bestStartMenuMatch('XBOX', installed)?.appId).toContain('GamingApp');
  });

  /// The reported sentence. Nobody says "Standard Edition" out loud.
  it('matches a game whose entry carries an edition after it', () => {
    expect(bestStartMenuMatch('Forza Horizon 6', installed)?.appId).toContain('SunriseBaseGame');
  });

  it('does not guess when nothing resembles the name', () => {
    expect(bestStartMenuMatch('Photoshop', installed)).toBeNull();
  });

  /// A prefix of a word is not a word. "Forza" alone would be a reasonable
  /// match; "For" must not silently start a game.
  it('does not match a fragment of a word', () => {
    expect(bestStartMenuMatch('For', installed)).toBeNull();
  });

  it('prefers the exact entry over the longer one that contains it', () => {
    const both = [{ name: 'Spotify Premium Trial', appId: 'trial!App' }, ...installed];
    expect(bestStartMenuMatch('Spotify', both)?.appId).toBe('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify');
  });
});

describe('the command for a Store application', () => {
  it('goes through AppsFolder, which is the only route that starts one', () => {
    expect(appsFolderCommand('Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App')).toEqual({
      file: 'explorer.exe',
      args: ['shell:AppsFolder\\Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App'],
    });
  });

  /// The id comes from the operating system rather than from the model, but it
  /// still lands in a command line, so the same closed-set rule applies.
  it('refuses an id with anything a shell would find interesting in it', () => {
    expect(appsFolderCommand('Evil" & calc.exe')).toBeNull();
    expect(appsFolderCommand('')).toBeNull();
  });
});
