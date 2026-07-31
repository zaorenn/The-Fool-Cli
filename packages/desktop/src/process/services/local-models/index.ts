/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile as execFileCallback } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { httpRequest } from '@/common/adapter/httpBridge';
import { ipcBridge } from '@/common';
import type { IProvider } from '@/common/config/storage';
import type { LocalModelListResult } from '@/common/types/provider/localModels';
import { readLmsCliModels, type LocalModelEntry } from './lmsCli';
import { scanModelDirectory } from './modelDirScan';
import { resolveLmStudioModels, type LmStudioSourceDeps, type ModelListTier } from './LmStudioModelSource';
import { publishLmStudioModels } from './LocalProviderRegistrar';

export { discoverAndRegisterLocalProviders, publishLmStudioModels } from './LocalProviderRegistrar';
export { isLmStudioProvider, mergeModelIds, resolveLmStudioModels } from './LmStudioModelSource';
export type { ModelListResult, ModelListTier } from './LmStudioModelSource';
export type { LocalModelEntry } from './lmsCli';

const execFileAsync = promisify(execFileCallback);
const DEFAULT_LM_STUDIO_PORT = 1234;
const HTTP_TIMEOUT_MS = 2000;

/** Reads the port LM Studio serves on, falling back to its documented default. */
export const readLmStudioPort = async (): Promise<number> => {
  try {
    const raw = await readFile(`${homedir()}/.lmstudio/.internal/http-server-config.json`, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'port' in parsed) {
      const { port } = parsed as { port: unknown };
      if (typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536) return port;
    }
  } catch {
    // Fall through to the default below.
  }
  return DEFAULT_LM_STUDIO_PORT;
};

/**
 * Resolves the directory scanned by the tier-2 fallback.
 *
 * LM Studio lets the user relocate this directory, but does not expose the
 * chosen path in any config file readable from outside the app. Tier 1 (`lms
 * ls`) reports models correctly regardless of location, so this fallback uses
 * the default path and simply finds nothing when the directory was moved.
 */
const readModelsRoot = async (): Promise<string | null> => {
  const root = `${homedir()}/.lmstudio/models`;
  try {
    await readdir(root);
    return root;
  } catch {
    return null;
  }
};

type OpenAiModelList = { data?: { id?: unknown }[] };

const readHttpModels = async (port: number): Promise<LocalModelEntry[] | null> => {
  for (const path of ['/api/v0/models', '/v1/models']) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) continue;

      const body = (await response.json()) as OpenAiModelList;
      if (!Array.isArray(body.data)) continue;

      return body.data
        .map((item) => item?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .map((id): LocalModelEntry => ({ id, displayName: id, contextLength: null, toolUse: false }));
    } catch {
      continue;
    }
  }
  return null;
};

/** What the local host has, and what it will answer for without loading first. */
export type LmStudioInventory = {
  /** The port the local server was found on. */
  port: number;
  /** Models the server answers for right now. */
  loaded: string[];
  /** Every installed model, loaded or not. */
  installed: string[];
  reachable: boolean;
};

type LmStudioRestModelList = { data?: { id?: unknown; state?: unknown; type?: unknown }[] };

/**
 * Reads which models are loaded, which is not the same as which are installed.
 *
 * LM Studio's own REST API reports a `state` per model; the OpenAI-compatible
 * route does not, and across versions has meant both "loaded" and "downloaded".
 * The native route is tried first for that reason, and the fallback treats
 * everything it lists as loaded — an over-generous answer that costs one slow
 * request rather than never using the model at all.
 */
const readLoadedModels = async (port: number): Promise<string[] | null> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    const response = await fetch(`http://127.0.0.1:${port}/api/v0/models`, { signal: controller.signal });
    clearTimeout(timeout);
    if (response.ok) {
      const body = (await response.json()) as LmStudioRestModelList;
      if (Array.isArray(body.data)) {
        return body.data
          .filter((item) => item?.state === 'loaded')
          .map((item) => item?.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
      }
    }
  } catch {
    // Fall through to the OpenAI-compatible route below.
  }

  const fallback = await readHttpModels(port);
  return fallback ? fallback.map((model) => model.id) : null;
};

const buildSource = (port: number): LmStudioSourceDeps => ({
  readCli: () => readLmsCliModels({ execFile: execFileAsync, homeDir: homedir() }),
  scanDir: (root) =>
    scanModelDirectory({
      fs: {
        readdir: async (path) =>
          (await readdir(path, { withFileTypes: true })).map((entry) => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
          })),
      },
      root,
    }),
  readHttp: () => readHttpModels(port),
  modelsRoot: readModelsRoot,
});

/**
 * The local model inventory, for callers that must choose a model to run.
 *
 * Kept here rather than in the caller because the port lookup, the CLI tier and
 * the HTTP tiers all already live in this module.
 */
export const readLmStudioInventory = async (): Promise<LmStudioInventory> => {
  const port = await readLmStudioPort();
  const loaded = await readLoadedModels(port);
  const { tier, models } = await resolveLmStudioModels(buildSource(port));

  return {
    port,
    loaded: loaded ?? [],
    installed: models.map((model) => model.id),
    reachable: loaded !== null || tier !== 'unavailable',
  };
};

/**
 * Publishes every installed LM Studio model into matching provider records.
 *
 * Safe to call repeatedly: it is a no-op when no LM Studio provider exists or
 * when the stored list is already complete.
 */
export const refreshLmStudioModels = async (): Promise<ModelListTier> => {
  const port = await readLmStudioPort();

  const { tier } = await publishLmStudioModels({
    source: buildSource(port),
    port,
    listProviders: async () => (await httpRequest<IProvider[]>('GET', '/api/providers')) || [],
    updateProvider: async (id, models) => {
      await httpRequest('PUT', `/api/providers/${id}`, { models });
    },
  });

  console.info(`[LocalModels] LM Studio model list refreshed (tier: ${tier})`);
  return tier;
};

/**
 * Registers the renderer-facing discovery endpoint.
 *
 * The settings model dropdown asks the backend, which can only see loaded
 * models; this lets the renderer merge in the full local set and show the
 * discovery tier so an incomplete list is never presented as complete.
 */
export const registerLocalModelsBridge = (): void => {
  ipcBridge.localModels.listLmStudioModels.provider(async (): Promise<LocalModelListResult> => {
    try {
      const port = await readLmStudioPort();
      const { tier, models } = await resolveLmStudioModels(buildSource(port));
      return { tier, models: models.map((model) => model.id) };
    } catch {
      return { tier: 'unavailable', models: [] };
    }
  });
};
