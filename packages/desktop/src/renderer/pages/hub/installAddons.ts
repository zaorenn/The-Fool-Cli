/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IMcpServer } from '@/common/config/storage';
import type { Workspace } from '@/common/config/workspaces';
import { normalizeAddonName, type WorkspaceAddon } from '@/common/config/workspaceAddon';

/**
 * Installing a workspace's addons, once the user has agreed to them.
 *
 * An addon becomes an ordinary MCP server in Settings → Tools. That is the point
 * rather than an implementation detail: it means an addon is not a hidden thing
 * a workspace carries around, it is a capability the user now *has* — visible in
 * the place they already manage capabilities, switch-off-able there, and usable
 * by anything else on the machine.
 *
 * It also means uninstalling is not this module's job. Somebody who wants an
 * addon gone removes the server, the same way they would remove any other, and
 * a workspace that needed it says so the next time its page is opened.
 */

/** The name an addon takes in the MCP list, so the two can be matched later. */
const serverName = (addon: WorkspaceAddon): string => addon.id;

/** Which of a workspace's addons are not installed yet. */
export const missingAddons = async (workspace: Workspace): Promise<WorkspaceAddon[]> => {
  if (workspace.addons.length === 0) return [];

  const servers = await ipcBridge.mcpService.listServers.invoke().catch((): IMcpServer[] => []);
  const have = new Set((servers ?? []).map((server) => normalizeAddonName(server.name)));

  return workspace.addons.filter((addon) => !have.has(addon.id));
};

/**
 * Creates a server for each addon, and answers with the ones that took.
 *
 * Reported by id rather than by a boolean, because a partial success is the
 * normal case: one package resolves, another does not exist, and the user needs
 * to know which half of their new workspace is going to work.
 *
 * Never throws. A failure here leaves the workspace installed and one capability
 * missing, which is recoverable; an exception would leave the import half-done
 * with nothing said about it.
 */
export const installAddons = async (addons: readonly WorkspaceAddon[]): Promise<string[]> => {
  const installed: string[] = [];

  for (const addon of addons) {
    try {
      const created = await ipcBridge.mcpService.createServer.invoke({
        name: serverName(addon),
        description: addon.purpose,
        transport: { type: 'stdio', command: addon.command, args: addon.args, env: {} },
        // Marked as the user's rather than shipped with the app: it arrived in a
        // workspace, and it must be removable like anything else they added.
        builtin: false,
        original_json: '',
      } as Parameters<typeof ipcBridge.mcpService.createServer.invoke>[0]);

      if (created?.id) installed.push(addon.id);
    } catch {
      // Left out of the answer, which is how the caller knows to say so.
    }
  }

  return installed;
};
