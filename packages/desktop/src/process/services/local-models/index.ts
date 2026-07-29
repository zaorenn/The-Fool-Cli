/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
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
