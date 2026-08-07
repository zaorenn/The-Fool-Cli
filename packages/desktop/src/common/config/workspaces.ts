/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A workspace: the whole app aimed at one purpose.
 *
 * Everything the app can be told — which shape a window is, who the assistant is
 * being, which agent and model do the work, which skills are switched on — is a
 * setting somewhere, and every one of them is global. That is fine while there
 * is one thing you use this for. It falls apart the moment there are two: the
 * setup that turns a Songsterr link into guitar tab is not the setup you want
 * for writing, and swapping between them by hand across five settings pages is
 * not something anyone does twice.
 *
 * So the settings that define a purpose are bundled and named. Switching
 * workspace applies all of them at once; what someone built can be handed to
 * somebody else as a file. What the app ships with is a workspace too — the
 * default one — so there is no special case for "no workspace", and no update
 * can rearrange a setup that was never chosen.
 *
 * Nothing here is a secret. A workspace names an agent and a model by id and
 * carries no keys, which is what makes it safe to send to another person: they
 * get the arrangement, not your account.
 */

import { DEFAULT_LAYOUT_ID, SURFACE_IDS, type SurfaceId } from './surfaceLayouts';
import { sanitizeAddons, type WorkspaceAddon } from './workspaceAddon';
import { sanitizeWorkspaceApp, type WorkspaceApp } from './workspaceApp';

/** How a workspace is stored, and what an exported file contains. */
export type Workspace = {
  /** Stable id, derived from the name the user gave it. */
  id: string;
  name: string;
  /** What it is for, in the user's words. Shown on the card and nowhere else. */
  description: string;
  /** True for the one that ships. It can be copied but never edited or deleted. */
  builtin: boolean;
  /** Which layout each surface wears in this workspace. */
  layouts: Partial<Record<SurfaceId, string>>;
  /** How the assistant behaves here. */
  voice: {
    personaPresetId: string;
    /** Added to the persona: what this workspace is for, in the user's words. */
    instructions: string;
    /** A language code, or `auto` to follow whoever is talking. */
    language: string;
  };
  /** Who does the real work, by id. Never a key. */
  agent: {
    assistantId: string;
    providerId: string;
    modelId: string;
  };
  /** Skills switched on here, by name. */
  skills: string[];
  /**
   * A page of its own, or none.
   *
   * This is what turns a workspace from a set of settings into a thing: a panel
   * that does one job, written from a spoken description, running inside the
   * app. Static, and reaching everything else through The Fool — see
   * {@link WorkspaceApp} for why it is not allowed a back end of its own.
   */
  app: WorkspaceApp | null;
  /**
   * Capabilities the app does not already have, as MCP servers.
   *
   * Declared rather than bundled, and never installed without the user seeing
   * the command first — see {@link WorkspaceAddon}. This is how a workspace gets
   * something like pitch detection without anybody forking the backend.
   */
  addons: WorkspaceAddon[];
  /** When it was last written, so a card can be ordered by recency. */
  updatedAt: string;
};

export const WORKSPACES_CONFIG_KEY = 'workspaces.library';
export const ACTIVE_WORKSPACE_CONFIG_KEY = 'workspaces.activeId';

/** The most a user may keep, oldest dropped first. */
export const MAX_WORKSPACES = 40;

export const MAX_WORKSPACE_NAME = 48;
export const MAX_WORKSPACE_TEXT = 2000;

/** The id of the one that ships, which is also the fallback for anything unknown. */
export const DEFAULT_WORKSPACE_ID = 'default';

/**
 * Trimmed, lower-cased and short enough to be said aloud.
 *
 * The same rule layouts and palettes use: workspaces are switched between by
 * voice, so a name has to be matched the way a person says it rather than the
 * way they typed it.
 */
export const normalizeWorkspaceName = (name: string): string =>
  name.trim().toLowerCase().replaceAll(/\s+/g, ' ').slice(0, MAX_WORKSPACE_NAME);

const text = (value: unknown, limit: number): string =>
  typeof value === 'string' ? value.replaceAll(/\s+/g, ' ').trim().slice(0, limit) : '';

/**
 * The workspace the app ships with.
 *
 * Every setting left as it comes, on purpose: this is the arrangement someone
 * has been using, and it becoming "a workspace" must not change a single thing
 * about it.
 */
export const defaultWorkspace = (): Workspace => ({
  id: DEFAULT_WORKSPACE_ID,
  name: 'Default',
  description: '',
  builtin: true,
  layouts: Object.fromEntries(SURFACE_IDS.map((surface) => [surface, DEFAULT_LAYOUT_ID[surface]])),
  voice: { personaPresetId: 'companion', instructions: '', language: 'auto' },
  agent: { assistantId: '', providerId: '', modelId: '' },
  skills: [],
  app: null,
  addons: [],
  updatedAt: new Date(0).toISOString(),
});

export type WorkspaceLibrary = Record<string, Workspace>;

/**
 * Repairs one workspace from whatever was stored or imported.
 *
 * Every field is read defensively because this arrives from three directions —
 * a config store, a file somebody was sent, and a model calling a tool — and
 * only the first of those is ours. A workspace that cannot be read degrades to
 * the defaults rather than taking a surface down.
 */
export const sanitizeWorkspace = (value: unknown, fallbackId = ''): Workspace | null => {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;

  const name = text(record.name, MAX_WORKSPACE_NAME);
  const id = normalizeWorkspaceName(text(record.id, MAX_WORKSPACE_NAME) || name || fallbackId);
  if (id.length === 0) return null;

  const base = defaultWorkspace();
  const voice = (record.voice ?? {}) as Record<string, unknown>;
  const agent = (record.agent ?? {}) as Record<string, unknown>;
  const layouts = (record.layouts ?? {}) as Record<string, unknown>;

  const chosen: Partial<Record<SurfaceId, string>> = {};
  for (const surface of SURFACE_IDS) {
    const layout = layouts[surface];
    if (typeof layout === 'string' && layout.trim().length > 0) chosen[surface] = normalizeWorkspaceName(layout);
  }

  return {
    id,
    name: name || id,
    description: text(record.description, MAX_WORKSPACE_TEXT),
    // Never taken from the data: an imported file claiming to be built in would
    // be a workspace nobody can delete.
    builtin: id === DEFAULT_WORKSPACE_ID,
    layouts: Object.keys(chosen).length > 0 ? chosen : base.layouts,
    voice: {
      personaPresetId: text(voice.personaPresetId, 48) || base.voice.personaPresetId,
      instructions: text(voice.instructions, MAX_WORKSPACE_TEXT),
      language: text(voice.language, 16) || base.voice.language,
    },
    agent: {
      assistantId: text(agent.assistantId, 128),
      providerId: text(agent.providerId, 128),
      modelId: text(agent.modelId, 128),
    },
    skills: Array.isArray(record.skills)
      ? record.skills.flatMap((skill) => {
          const cleaned = text(skill, 64);
          return cleaned.length > 0 ? [cleaned] : [];
        })
      : [],
    app: sanitizeWorkspaceApp(record.app),
    addons: sanitizeAddons(record.addons),
    updatedAt:
      typeof record.updatedAt === 'string' && !Number.isNaN(Date.parse(record.updatedAt))
        ? record.updatedAt
        : new Date().toISOString(),
  };
};

/** Repairs the whole library, always including the one that ships. */
export const sanitizeWorkspaces = (value: unknown): WorkspaceLibrary => {
  const library: WorkspaceLibrary = { [DEFAULT_WORKSPACE_ID]: defaultWorkspace() };
  if (typeof value !== 'object' || value === null) return library;

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    // The shipped one is rebuilt from code rather than read back, so a stored
    // copy cannot drift from what the app actually does by default.
    if (normalizeWorkspaceName(key) === DEFAULT_WORKSPACE_ID) continue;
    const workspace = sanitizeWorkspace(entry, key);
    if (workspace) library[workspace.id] = workspace;
  }

  const kept = Object.entries(library).slice(-MAX_WORKSPACES);
  return Object.fromEntries(kept);
};

/** Which workspace is in force, falling back rather than failing. */
export const resolveWorkspace = (library: WorkspaceLibrary, activeId: unknown): Workspace => {
  const wanted = typeof activeId === 'string' ? normalizeWorkspaceName(activeId) : '';
  return library[wanted] ?? library[DEFAULT_WORKSPACE_ID] ?? defaultWorkspace();
};

/** Everything on offer, the shipped one first and the rest by name. */
export const listWorkspaces = (library: WorkspaceLibrary): Workspace[] => {
  const rest = Object.values(library)
    .filter((workspace) => workspace.id !== DEFAULT_WORKSPACE_ID)
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const shipped = library[DEFAULT_WORKSPACE_ID];
  return shipped ? [shipped, ...rest] : rest;
};

/**
 * Finds one by whatever the user called it, for a spoken request.
 *
 * Exact first, then loosely, because "put me back in the guitar one" is how
 * someone refers to a thing they named once and never typed again.
 */
export const findWorkspaceByName = (library: WorkspaceLibrary, name: string): Workspace | null => {
  const wanted = normalizeWorkspaceName(name);
  if (wanted.length === 0) return null;

  const all = listWorkspaces(library);
  const exact = all.find((workspace) => workspace.id === wanted || normalizeWorkspaceName(workspace.name) === wanted);
  if (exact) return exact;

  return (
    all.find((workspace) => {
      const label = normalizeWorkspaceName(workspace.name);
      return label.includes(wanted) || wanted.includes(label);
    }) ?? null
  );
};

/** What the app writes into a file somebody can be sent. */
export const WORKSPACE_FILE_KIND = 'the-fool/workspace';
export const WORKSPACE_FILE_VERSION = 1;

export type WorkspaceFile = {
  kind: typeof WORKSPACE_FILE_KIND;
  version: number;
  workspace: Workspace;
  /**
   * The app's own files, by relative path.
   *
   * Carried inside the file rather than fetched afterwards, because a workspace
   * that arrives and then cannot find its own page is a workspace that does not
   * work — and the person who received it has nothing to go and get. Text only
   * and bounded: this is meant to be small enough to send in a message.
   */
  files?: Record<string, string>;
};

/**
 * A workspace as a file, ready to send to somebody.
 *
 * Stamped with what it is and which version wrote it, so an import can say "this
 * is not a workspace" rather than quietly building a broken one out of whatever
 * JSON it was handed.
 */
export const exportWorkspace = (workspace: Workspace, files: Record<string, string> = {}): string =>
  `${JSON.stringify(
    {
      kind: WORKSPACE_FILE_KIND,
      version: WORKSPACE_FILE_VERSION,
      workspace,
      ...(Object.keys(files).length > 0 ? { files } : {}),
    },
    null,
    2
  )}\n`;

export type WorkspaceImport =
  | { ok: true; workspace: Workspace; files: Record<string, string> }
  | { ok: false; reason: 'not-a-workspace' | 'unreadable' };

/** File names an imported workspace may carry. Text only, and nothing executable. */
const APP_FILE = /\.(html|css|js|mjs|json|svg|txt|md)$/i;

/**
 * The app's files, as far as a file from another person can be trusted.
 *
 * Names are checked here and again by the writer that puts them on disk. Two
 * checks on the same thing is not belt and braces — the cost of missing it once
 * is a file written wherever the sender chose, and the two live far enough apart
 * that neither can assume the other ran.
 */
const safeFiles = (value: unknown): Record<string, string> => {
  if (typeof value !== 'object' || value === null) return {};

  const files: Record<string, string> = {};
  for (const [name, contents] of Object.entries(value as Record<string, unknown>)) {
    if (typeof contents !== 'string') continue;

    const cleaned = name.replaceAll('\\', '/').trim();
    if (cleaned.length === 0 || cleaned.startsWith('/') || /^[a-z]+:/i.test(cleaned)) continue;
    if (cleaned.split('/').includes('..')) continue;
    if (!APP_FILE.test(cleaned)) continue;

    files[cleaned] = contents;
  }
  return files;
};

/**
 * Reads a file somebody was sent.
 *
 * Refuses rather than guesses. This is a file that arrived from another person,
 * so the failure that matters is not a malformed one — it is a well-formed file
 * that is not this at all, silently becoming a workspace that rearranges the
 * app.
 */
export const importWorkspace = (contents: string): WorkspaceImport => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: 'not-a-workspace' };
  const file = parsed as Partial<WorkspaceFile>;
  if (file.kind !== WORKSPACE_FILE_KIND) return { ok: false, reason: 'not-a-workspace' };

  const workspace = sanitizeWorkspace(file.workspace);
  if (!workspace) return { ok: false, reason: 'not-a-workspace' };

  // An imported copy of the shipped one is a copy, not a replacement: the
  // default is the app's and nothing arriving from outside may overwrite it.
  const files = safeFiles(file.files);

  if (workspace.id === DEFAULT_WORKSPACE_ID) {
    return {
      ok: true,
      workspace: { ...workspace, id: 'default-copy', name: `${workspace.name} (copy)`, builtin: false },
      files,
    };
  }

  return { ok: true, workspace, files };
};

/** A file name for a workspace, safe on every filesystem. */
export const workspaceFileName = (workspace: Workspace): string => {
  const slug =
    workspace.name
      .trim()
      .toLowerCase()
      .replaceAll(/[^\p{L}\p{N}]+/gu, '-')
      .replaceAll(/^-+|-+$/g, '')
      .slice(0, MAX_WORKSPACE_NAME) || 'workspace';
  return `${slug}.foolspace.json`;
};
