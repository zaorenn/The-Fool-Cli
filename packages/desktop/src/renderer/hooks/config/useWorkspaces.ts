/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { configService } from '@/common/config/configService';
import { SURFACE_LAYOUT_CONFIG_KEY, sanitizeSurfaceLayouts, type SurfaceId } from '@/common/config/surfaceLayouts';
import {
  ACTIVE_WORKSPACE_CONFIG_KEY,
  DEFAULT_WORKSPACE_ID,
  listWorkspaces,
  MAX_WORKSPACES,
  normalizeWorkspaceName,
  resolveWorkspace,
  sanitizeWorkspaces,
  WORKSPACES_CONFIG_KEY,
  type Workspace,
  type WorkspaceLibrary,
} from '@/common/config/workspaces';
import { peekVoiceSettings, writeVoiceSettings } from '@renderer/services/voice/voiceSettingsStore';

/**
 * Workspaces, and what switching to one actually does.
 *
 * The library is a setting like any other. What is not like any other is
 * {@link enterWorkspace}: a workspace is only a real thing if choosing it moves
 * every setting it names, all at once. A picker that stored a choice and left
 * the app exactly as it was would be a label rather than a workspace, and the
 * user would find that out one setting at a time.
 */

export const peekWorkspaces = (): WorkspaceLibrary => sanitizeWorkspaces(configService.get(WORKSPACES_CONFIG_KEY));

export const peekActiveWorkspace = (): Workspace =>
  resolveWorkspace(peekWorkspaces(), configService.get(ACTIVE_WORKSPACE_CONFIG_KEY));

/**
 * Puts a workspace on, moving every setting it names.
 *
 * The voice settings and the layout selection are written separately because
 * they are separate settings — this is the one place that knows they belong to
 * the same idea. Anything the workspace leaves blank is left alone rather than
 * cleared: a workspace that names no agent means "whichever one I had", not
 * "none", and clearing it would break the app for someone who only wanted a
 * different layout.
 */
export const enterWorkspace = async (workspace: Workspace): Promise<void> => {
  await configService.set(ACTIVE_WORKSPACE_CONFIG_KEY, workspace.id);

  const layouts = sanitizeSurfaceLayouts(configService.get(SURFACE_LAYOUT_CONFIG_KEY));
  const wanted = Object.entries(workspace.layouts).filter(([, id]) => typeof id === 'string' && id.length > 0);
  if (wanted.length > 0) {
    await configService.set(SURFACE_LAYOUT_CONFIG_KEY, { ...layouts, ...Object.fromEntries(wanted) });
  }

  const settings = peekVoiceSettings();
  await writeVoiceSettings({
    ...settings,
    realtime: {
      ...settings.realtime,
      personaPresetId: (workspace.voice.personaPresetId ||
        settings.realtime.personaPresetId) as typeof settings.realtime.personaPresetId,
      language: workspace.voice.language || settings.realtime.language,
      customInstructions: workspace.voice.instructions,
    },
    session: {
      ...settings.session,
      assistantId: workspace.agent.assistantId || settings.session.assistantId,
      providerId: workspace.agent.providerId || settings.session.providerId,
      modelId: workspace.agent.modelId || settings.session.modelId,
    },
  });
};

/**
 * Writes a workspace down as the app is set up right now.
 *
 * The point of building one is that you have already arranged things: the
 * arrangement is on screen, and asking someone to retype it into a form would be
 * asking them to do the work twice.
 */
export const captureWorkspace = (name: string, description: string): Workspace => {
  const settings = peekVoiceSettings();
  const layouts = sanitizeSurfaceLayouts(configService.get(SURFACE_LAYOUT_CONFIG_KEY));

  return {
    id: normalizeWorkspaceName(name),
    name: name.trim().slice(0, 48),
    description: description.trim().slice(0, 2000),
    builtin: false,
    layouts: layouts as Partial<Record<SurfaceId, string>>,
    voice: {
      personaPresetId: settings.realtime.personaPresetId,
      instructions: settings.realtime.customInstructions,
      language: settings.realtime.language,
    },
    agent: {
      assistantId: settings.session.assistantId,
      providerId: settings.session.providerId,
      modelId: settings.session.modelId,
    },
    skills: [],
    updatedAt: new Date().toISOString(),
  };
};

/** Keeps a workspace and switches to it, because saving one means using it. */
export const saveWorkspace = async (workspace: Workspace): Promise<Workspace | null> => {
  if (workspace.id.length === 0 || workspace.id === DEFAULT_WORKSPACE_ID) return null;

  const library = peekWorkspaces();
  const kept = Object.entries(library)
    .filter(([key]) => key !== workspace.id && key !== DEFAULT_WORKSPACE_ID)
    .slice(-(MAX_WORKSPACES - 2));

  const next = { ...workspace, updatedAt: new Date().toISOString() };
  await configService.set(WORKSPACES_CONFIG_KEY, Object.fromEntries([...kept, [workspace.id, next]]));
  await enterWorkspace(next);
  return next;
};

/** Drops one the user made. The shipped one is not theirs to delete. */
export const deleteWorkspace = async (id: string): Promise<boolean> => {
  const wanted = normalizeWorkspaceName(id);
  if (wanted === DEFAULT_WORKSPACE_ID) return false;

  const library = peekWorkspaces();
  if (!library[wanted]) return false;

  const { [wanted]: _removed, ...rest } = library;
  await configService.set(WORKSPACES_CONFIG_KEY, rest);

  // Leaving someone in a workspace that no longer exists would resolve back to
  // the default on the next read; doing it now means the app moves while they
  // are looking at it rather than on the next launch.
  if (normalizeWorkspaceName(String(configService.get(ACTIVE_WORKSPACE_CONFIG_KEY) ?? '')) === wanted) {
    await enterWorkspace(resolveWorkspace(rest, DEFAULT_WORKSPACE_ID));
  }
  return true;
};

export type WorkspacesHandle = {
  workspaces: Workspace[];
  active: Workspace;
  enter: (workspace: Workspace) => Promise<void>;
  save: (workspace: Workspace) => Promise<Workspace | null>;
  remove: (id: string) => Promise<boolean>;
  capture: (name: string, description: string) => Workspace;
};

export const useWorkspaces = (): WorkspacesHandle => {
  const [library, setLibrary] = useState<WorkspaceLibrary>(peekWorkspaces);
  const [active, setActive] = useState<Workspace>(peekActiveWorkspace);

  useEffect(() => {
    const read = (): void => {
      setLibrary(peekWorkspaces());
      setActive(peekActiveWorkspace());
    };

    read();
    // Both keys: a workspace edited elsewhere changes what the active id
    // resolves to even though the id itself has not moved.
    const offLibrary = configService.subscribe(WORKSPACES_CONFIG_KEY, read);
    const offActive = configService.subscribe(ACTIVE_WORKSPACE_CONFIG_KEY, read);

    return () => {
      offLibrary();
      offActive();
    };
  }, []);

  return {
    workspaces: listWorkspaces(library),
    active,
    enter: useCallback((workspace: Workspace) => enterWorkspace(workspace), []),
    save: useCallback((workspace: Workspace) => saveWorkspace(workspace), []),
    remove: useCallback((id: string) => deleteWorkspace(id), []),
    capture: useCallback((name: string, description: string) => captureWorkspace(name, description), []),
  };
};
