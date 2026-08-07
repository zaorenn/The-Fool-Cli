/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The capabilities a workspace needs that the app does not already have.
 *
 * A workspace's page can hand a job to the agent, and for most things that is
 * enough. It is not enough for the things people actually want a purpose-built
 * app for. "Turn this video into guitar tab" is not a request an agent satisfies
 * by thinking harder — it needs audio pulled down, pitch detected, notes fitted
 * to a fretboard. That is a *capability*, and it either exists on the machine or
 * it does not.
 *
 * So a workspace can declare addons. An addon is an MCP server: the app's own
 * extension point, already installed and managed in Settings → Tools, already
 * how every other capability reaches an agent here. Declaring one does not
 * change the backend and does not fork it — it plugs into the socket that was
 * already there.
 *
 * What is different from a skill: a skill tells an agent *how* to do something
 * it could already do, and costs a minute of the agent thinking. An addon gives
 * the page a function it can call directly — deterministic, in a second, with no
 * model in the loop. A page that needs pitch detection needs the second kind.
 *
 * ## The thing this must never do quietly
 *
 * An addon names a command that gets run. A workspace is a file people send each
 * other. Those two facts together are remote code execution by file share, and
 * the only honest answer is that **an imported addon is never installed without
 * the user seeing the command and agreeing to it.** Not a checkbox buried in a
 * dialog: the actual command line, in front of them, before anything runs.
 *
 * That is why {@link describeAddonCommand} exists and why the import path has an
 * approval step. It is the difference between an extension system and a way to
 * mail somebody a payload.
 */

/** One capability a workspace needs, as an MCP server it declares. */
export type WorkspaceAddon = {
  /** Stable id, from the name. */
  id: string;
  name: string;
  /** What it gives the workspace, in one sentence, for the approval screen. */
  purpose: string;
  /** The command that will be run. Shown to the user before anything happens. */
  command: string;
  args: string[];
  /**
   * The tools the page calls.
   *
   * Declared so a page can be checked against what actually arrived: a server
   * that installed but exposes none of these is a broken addon, and saying so is
   * better than a button that silently does nothing.
   */
  tools: string[];
};

export const MAX_ADDON_NAME = 48;
export const MAX_ADDON_ARGS = 24;

/** The most a workspace may ask for, so one file cannot install a suite. */
export const MAX_ADDONS = 6;

export const normalizeAddonName = (name: string): string =>
  name.trim().toLowerCase().replaceAll(/\s+/g, ' ').slice(0, MAX_ADDON_NAME);

const text = (value: unknown, limit: number): string =>
  typeof value === 'string' ? value.replaceAll(/\s+/g, ' ').trim().slice(0, limit) : '';

/**
 * Commands an addon may name.
 *
 * A deliberate allow-list rather than a block-list. The point of a block-list
 * would be to guess every dangerous thing somebody might write, which cannot be
 * done; the point of this is that an MCP server is started one of four ways, and
 * anything else is not an addon — it is something else wearing the word.
 *
 * This does not make an addon safe. It makes it *legible*: what the user is
 * shown and approves is a package name they can look up, not a shell line they
 * would have to parse.
 */
const ALLOWED_COMMANDS = new Set(['npx', 'uvx', 'node', 'python', 'python3']);

export const sanitizeAddon = (value: unknown): WorkspaceAddon | null => {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;

  const name = text(record.name, MAX_ADDON_NAME);
  const command = text(record.command, 32).toLowerCase();
  if (name.length === 0 || !ALLOWED_COMMANDS.has(command)) return null;

  const args = Array.isArray(record.args)
    ? record.args.flatMap((arg) => {
        const cleaned = text(arg, 200);
        // A shell metacharacter in an argument is how an allow-listed command
        // becomes an arbitrary one. These are passed to a process rather than to
        // a shell, but an argument that looks like a pipeline is not an argument
        // anybody meant to write.
        return cleaned.length > 0 && !/[;&|`$><\n]/.test(cleaned) ? [cleaned] : [];
      })
    : [];

  return {
    id: normalizeAddonName(name),
    name,
    purpose: text(record.purpose, 400),
    command,
    args: args.slice(0, MAX_ADDON_ARGS),
    tools: Array.isArray(record.tools)
      ? record.tools.flatMap((tool) => {
          const cleaned = text(tool, 64);
          return cleaned.length > 0 ? [cleaned] : [];
        })
      : [],
  };
};

export const sanitizeAddons = (value: unknown): WorkspaceAddon[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const addons: WorkspaceAddon[] = [];

  for (const entry of value) {
    const addon = sanitizeAddon(entry);
    if (!addon || seen.has(addon.id)) continue;
    seen.add(addon.id);
    addons.push(addon);
    if (addons.length === MAX_ADDONS) break;
  }

  return addons;
};

/**
 * Exactly what will run, as one line the user can read.
 *
 * The whole approval step rests on this being the truth rather than a summary of
 * it. Somebody deciding whether to trust a workspace from a stranger is deciding
 * about this string.
 */
export const describeAddonCommand = (addon: WorkspaceAddon): string => [addon.command, ...addon.args].join(' ');

/** Whether an addon names a tool the page says it calls. */
export const addonProvides = (addon: WorkspaceAddon, tool: string): boolean =>
  addon.tools.some((provided) => provided.toLowerCase() === tool.trim().toLowerCase());

/** The addon that provides a tool, for routing a call from the page. */
export const addonForTool = (addons: readonly WorkspaceAddon[], tool: string): WorkspaceAddon | null =>
  addons.find((addon) => addonProvides(addon, tool)) ?? null;
