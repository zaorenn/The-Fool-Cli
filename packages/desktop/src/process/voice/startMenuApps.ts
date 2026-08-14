/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What is installed, as the Start menu lists it.
 *
 * `cmd /c start "" "<name>"` resolves through PATH and App Paths, and a Store
 * application is in neither. Measured on Windows 11 with the Xbox app
 * installed: that command launched nothing and never returned, while
 * `explorer.exe shell:AppsFolder\<AppUserModelID>` opened it at once. The name
 * a person says has to become an AppUserModelID first, and the Start menu is
 * the only place that knows them.
 *
 * `Get-StartApps` is the supported way to ask. It costs a PowerShell start —
 * one to two seconds on a machine with a couple of hundred entries — so the
 * answer is cached: a spoken "open X" must not pay for an enumeration every
 * time, and applications are not installed mid-sentence.
 */

import { execFile } from 'node:child_process';

import type { StartMenuApp } from '@/common/voice/appLaunch';

/**
 * How long the list is trusted.
 *
 * Long enough that a conversation never enumerates twice, short enough that
 * something installed while the app is running is found without a restart.
 */
const CACHE_MS = 5 * 60_000;

let cached: { apps: readonly StartMenuApp[]; at: number } | null = null;

/** Only the two fields matter, and anything else PowerShell adds is dropped. */
const parse = (json: string): readonly StartMenuApp[] => {
  try {
    const raw: unknown = JSON.parse(json);
    // A single entry comes back as an object rather than an array of one.
    const rows = Array.isArray(raw) ? raw : [raw];
    return rows
      .map((row) => row as { Name?: unknown; AppID?: unknown })
      .filter((row) => typeof row.Name === 'string' && typeof row.AppID === 'string')
      .map((row) => ({ name: row.Name as string, appId: row.AppID as string }));
  } catch {
    return [];
  }
};

/**
 * The installed applications, or an empty list.
 *
 * Empty rather than thrown on every failure path. This is one of two routes to
 * opening something — the caller still has `start` to fall back on — so a
 * PowerShell that is missing, disabled by policy or slow must degrade to the
 * behaviour that existed before this file, not stop the launch.
 */
export const listStartMenuApps = (): Promise<readonly StartMenuApp[]> => {
  if (process.platform !== 'win32') return Promise.resolve([]);

  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return Promise.resolve(cached.apps);

  return new Promise((resolve) => {
    execFile(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress',
      ],
      { timeout: 10_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        const apps = parse(stdout);
        // Only a real answer is cached. Caching an empty list because
        // PowerShell was briefly busy would make every launch for the next five
        // minutes fall back, which reads to the user as the feature coming and
        // going for no reason.
        if (apps.length > 0) cached = { apps, at: Date.now() };
        resolve(apps);
      }
    );
  });
};

/** Drops the cache, so a test does not inherit another test's machine. */
export const resetStartMenuCacheForTest = (): void => {
  cached = null;
};
