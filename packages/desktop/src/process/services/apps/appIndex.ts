/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IndexedApp } from '@/common/voice/appLaunch';

/**
 * What is actually installed on this computer.
 *
 * `appLaunch.ts` turns a name into a command, and on Windows that command is
 * `start "" <name>` — which resolves only a name the system already knows,
 * through the `App Paths` registry or `PATH`. Measured on a real machine:
 * Spotify and notepad opened; **Discord and Steam did not**, because both
 * install per-user and neither registers a command. The request failed outright,
 * for two applications sitting in the user's own Start menu.
 *
 * Every desktop keeps this list. Windows has `Get-StartApps`, which returns the
 * Start menu exactly as the user sees it — Store apps included — and hands back
 * an id that `explorer shell:AppsFolder\…` will launch whatever kind of thing it
 * turns out to be. macOS has `/Applications`. Linux has the `.desktop` files.
 * None of it is expensive and none of it was being read.
 *
 * Cached, because it is a list of installed programs: it changes when somebody
 * installs something, which is not something that happens between two sentences.
 */

/** How long a built index is trusted before it is built again. */
const CACHE_MS = 5 * 60 * 1000;

/** Long enough for a cold PowerShell, short enough not to hold a spoken turn. */
const SCAN_TIMEOUT_MS = 12_000;

/** Bounded so a machine with an enormous menu cannot fill the prompt or the heap. */
const MAX_APPS = 800;

type Cached = { at: number; apps: IndexedApp[] };

let cache: Cached | null = null;
/** The scan in flight, so two spoken requests at once do not run two of them. */
let building: Promise<IndexedApp[]> | null = null;

const run = (file: string, args: readonly string[]): Promise<string> =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { timeout: SCAN_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        // Answered as "nothing" rather than as a failure: an index that could not
        // be built means the caller falls back to the command path, which is
        // what it did before this existed.
        if (error && !stdout) resolve('');
        else resolve(stdout ?? '');
      }
    );
  });

/**
 * The Start menu, as the user sees it.
 *
 * `Get-StartApps` rather than walking the shortcut folders: it is the same list
 * the Start menu draws, so it already contains the Store applications that have
 * no `.lnk` anywhere on disk — Spotify on this machine is one — and it hands
 * back an AppID that launches either kind through one mechanism. Walking
 * `%APPDATA%\…\Start Menu` finds the Win32 half and silently misses the rest.
 *
 * Read as JSON rather than as a table, because an application called
 * `Something | Else` would otherwise split into two columns.
 */
const windowsApps = async (): Promise<IndexedApp[]> => {
  const out = await run('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    'Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress',
  ]);
  if (out.trim().length === 0) return [];

  try {
    const parsed: unknown = JSON.parse(out);
    // A machine with exactly one application gets an object rather than a list.
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap((row): IndexedApp[] => {
      if (typeof row !== 'object' || row === null) return [];
      const { Name, AppID } = row as { Name?: unknown; AppID?: unknown };
      if (typeof Name !== 'string' || typeof AppID !== 'string') return [];
      if (Name.trim().length === 0 || AppID.trim().length === 0) return [];
      return [{ name: Name.trim(), launchId: AppID.trim() }];
    });
  } catch {
    return [];
  }
};

/** Where macOS keeps applications, in the order it looks for them. */
const MAC_APP_DIRS = ['/Applications', '/System/Applications', '/Applications/Utilities'];

const macApps = async (): Promise<IndexedApp[]> => {
  const found: IndexedApp[] = [];

  for (const directory of MAC_APP_DIRS) {
    const entries = await fs.readdir(directory).catch((): string[] => []);
    for (const entry of entries) {
      if (!entry.endsWith('.app')) continue;
      // The bundle path is the launch id: `open` takes it directly, and unlike
      // `open -a <name>` it cannot resolve to a different application of the
      // same name somewhere else on the disk.
      found.push({ name: entry.slice(0, -'.app'.length), launchId: path.join(directory, entry) });
    }
  }

  return found;
};

/** Where a freedesktop system keeps its application entries. */
const linuxAppDirs = (): string[] => {
  const home = process.env.HOME ?? '';
  return [
    '/usr/share/applications',
    '/usr/local/share/applications',
    '/var/lib/flatpak/exports/share/applications',
    ...(home ? [path.join(home, '.local', 'share', 'applications')] : []),
  ];
};

/**
 * The name a `.desktop` file says it has.
 *
 * The localised `Name[tr]` is deliberately ignored: the point of the index is to
 * be matched against, and the folded comparison already handles the alphabet.
 * A file with no `Name` and one marked `NoDisplay` are both skipped — neither is
 * something a person would ask for by name.
 */
const desktopEntryName = (body: string): string | null => {
  if (/^NoDisplay\s*=\s*true/im.test(body)) return null;
  const name = /^Name\s*=\s*(.+)$/im.exec(body)?.[1]?.trim();
  return name && name.length > 0 ? name : null;
};

const linuxApps = async (): Promise<IndexedApp[]> => {
  const found: IndexedApp[] = [];

  for (const directory of linuxAppDirs()) {
    const entries = await fs.readdir(directory).catch((): string[] => []);
    for (const entry of entries) {
      if (!entry.endsWith('.desktop')) continue;
      const body = await fs.readFile(path.join(directory, entry), 'utf8').catch((): string => '');
      const name = body.length > 0 ? desktopEntryName(body) : null;
      if (name === null) continue;
      // `gtk-launch` takes the id, which is the file name without its suffix.
      found.push({ name, launchId: entry.slice(0, -'.desktop'.length) });
    }
  }

  return found;
};

/** The same thing listed twice — a shortcut in both Start menus — is one thing. */
const deduplicate = (apps: readonly IndexedApp[]): IndexedApp[] => {
  const byId = new Map<string, IndexedApp>();
  for (const app of apps) {
    if (!byId.has(app.launchId)) byId.set(app.launchId, app);
  }
  return [...byId.values()].slice(0, MAX_APPS);
};

const scan = async (): Promise<IndexedApp[]> => {
  if (process.platform === 'win32') return deduplicate(await windowsApps());
  if (process.platform === 'darwin') return deduplicate(await macApps());
  if (process.platform === 'linux') return deduplicate(await linuxApps());
  return [];
};

/**
 * The installed applications, from cache when there is a fresh one.
 *
 * Never throws and never rejects: an index that could not be built is an empty
 * one, and an empty one sends the caller back to the command path this exists to
 * improve on rather than failing the request.
 */
export const installedApps = async (): Promise<IndexedApp[]> => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.apps;
  if (building) return building;

  building = scan()
    .then((apps) => {
      cache = { at: Date.now(), apps };
      return apps;
    })
    .catch((): IndexedApp[] => [])
    .finally(() => {
      building = null;
    });

  return building;
};

/**
 * Builds the index now, without anybody waiting for it.
 *
 * Called once the app has settled. The first spoken "open Spotify" would
 * otherwise pay for a cold PowerShell — measured at 422 ms on the machine this
 * was written on — in the middle of a turn, which is exactly where the app can
 * least afford it.
 */
export const warmAppIndex = (): void => {
  void installedApps();
};

/** Forgets what was found, for a test and for an install that just finished. */
export const forgetAppIndex = (): void => {
  cache = null;
};
