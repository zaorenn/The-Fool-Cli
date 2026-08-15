/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where the officecli binary this application ships actually is.
 *
 * It used to be looked for on `PATH`, and when it was not there the app
 * downloaded a script from the internet and executed it — `irm … | iex` on
 * Windows. Meanwhile ten builtin skills and six assistants described Word,
 * Excel and PowerPoint editing to the model as things it could do, and whether
 * that was true depended on a network fetch nobody could see.
 *
 * OfficeCLI is Apache-2.0 and publishes self-contained native binaries, so the
 * honest arrangement is to ship one: `scripts/fetch-officecli.mjs` puts a
 * pinned, checksummed copy under `resources/officecli/<platform>` at build
 * time, and electron-builder packages it.
 *
 * This module answers one question — is it there, and where — and the answer
 * decides whether the MCP server is registered at all. **A server that cannot
 * start must not appear in the user's list**: the model reads the tool list and
 * believes it, then discovers the failure in the middle of somebody's work.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

/** The binary's name on this platform. */
const binaryName = (platform: NodeJS.Platform = process.platform): string =>
  platform === 'win32' ? 'officecli.exe' : 'officecli';

/**
 * Every place the packaged binary could be, in the order worth trying.
 *
 * `process.resourcesPath` is where electron-builder's `extraResources` land in
 * an installed app; the repository path is where a development run finds it.
 * Both are listed because the same code runs in both and guessing which is
 * which from `app.isPackaged` has been wrong before.
 */
export const officecliCandidates = (
  resourcesPath: string | undefined,
  appPath: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string[] => {
  const name = binaryName(platform);
  const folder = `${platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux'}-${arch}`;

  const candidates: string[] = [];
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'officecli', name));
    candidates.push(path.join(resourcesPath, 'officecli', folder, name));
  }
  candidates.push(path.join(appPath, 'resources', 'officecli', folder, name));
  candidates.push(path.join(appPath, 'resources', 'officecli', name));
  return candidates;
};

/**
 * The bundled binary, or null when this build does not carry one.
 *
 * Null is not a failure to handle later — it is the reason the Office server is
 * not registered, and the reason the skills that describe it check first.
 */
export const resolveBundledOfficecli = (
  resourcesPath: string | undefined = process.resourcesPath,
  appPath: string = process.cwd()
): string | null => officecliCandidates(resourcesPath, appPath).find((candidate) => existsSync(candidate)) ?? null;

/**
 * The MCP server invocation for the bundled binary, or null.
 *
 * officecli speaks MCP itself, which is why the skills that used to carry a
 * bash-to-PowerShell translation table no longer need one: a tool call is the
 * same on every platform, a shell command is not.
 *
 * `mcp` with **no argument**, and the distinction is not cosmetic. Verified
 * against the pinned binary — `officecli.exe mcp --help` on v1.0.144:
 *
 *     officecli mcp            Start MCP stdio server (for AI agents)
 *     officecli mcp <target>   Register officecli with an MCP client
 *
 * So a plausible-looking `['mcp', 'serve']` would be read as a *target* named
 * "serve" and try to register with a client that does not exist, instead of
 * starting the server. It was written that way first, from the README, and the
 * binary's own help is what corrected it.
 */
export const OFFICECLI_MCP_ARGS: readonly string[] = ['mcp'];

export const officeServerCommand = (
  resourcesPath: string | undefined = process.resourcesPath,
  appPath: string = process.cwd()
): { command: string; args: string[] } | null => {
  const binary = resolveBundledOfficecli(resourcesPath, appPath);
  return binary ? { command: binary, args: [...OFFICECLI_MCP_ARGS] } : null;
};
