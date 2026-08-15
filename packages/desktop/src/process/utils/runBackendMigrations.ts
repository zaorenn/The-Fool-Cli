/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { migrateConfigStorage, migrateLegacyMcpConfigToDb, migrateProviders } from '@/common/config/configMigration';
import { httpRequest } from '@/common/adapter/httpBridge';
import { mcpService } from '@/common/adapter/ipcBridge';
import { discoverAndRegisterLocalProviders, refreshLmStudioModels } from '../services/local-models';
import type { ImageGenerationModelSetting } from '@/common/config/clientSettings';
import {
  removeImageGenerationEnvKeys,
  resolveImageGenerationMcpEnv,
  type ImageGenerationMcpEnvResolveResult,
} from '@/common/config/imageGenerationMcpEnv';
import { BUILTIN_IMAGE_GEN_NAME, type IMcpServer, type IProvider } from '@/common/config/storage';
import { getBuiltinMcpScriptPath, type ProcessConfig as ProcessConfigType } from './initStorage';
import {
  BUILTIN_BROWSER_NAME,
  BUILTIN_APP_SETTINGS_NAME,
  BUILTIN_OFFICE_NAME,
  BUILTIN_PDF_NAME,
} from '../resources/builtinMcp/constants';
import { officeServerCommand } from '../resources/builtinMcp/officeServerCommand';
import { browserControlHandshakePath } from '../browser/browserControlServer';
import { migrateAssistantsToBackend } from './migrateAssistants';

type ConfigFile = typeof ProcessConfigType;
type MigrationStepResult = boolean;
type McpImportServer = Partial<IMcpServer> & Pick<IMcpServer, 'name' | 'transport'>;
type BackendClientPreferences = Record<string, unknown>;
const BUILTIN_CHROME_DEVTOOLS_NAME = 'chrome-devtools';
const BUILTIN_COMPUTER_USE_NAME = 'computer-use';

const LEGACY_BACKEND_CLIENT_PREFERENCE_KEYS = [
  'assistants',
  'migration.assistantEnabledFixed',
  'migration.coworkDefaultSkillsAdded',
  'migration.builtinDefaultSkillsAdded_v2',
  'migration.promptsI18nAdded',
  'migration.assistantsSplitCustom',
] as const;

async function cleanupLegacyClientPreferences(): Promise<void> {
  const payloadEntries = LEGACY_BACKEND_CLIENT_PREFERENCE_KEYS.map((key): [string, null] => [key, null]);
  const payload = Object.fromEntries(payloadEntries);
  await httpRequest<void>('PUT', '/api/settings/client', payload);
}

const CLEANUP_STEPS: Array<{
  name: string;
  run: () => Promise<void>;
}> = [{ name: 'cleanupLegacyClientPreferences', run: async () => cleanupLegacyClientPreferences() }];

async function fetchBackendClientPreferences(): Promise<BackendClientPreferences> {
  try {
    return (await httpRequest<BackendClientPreferences>('GET', '/api/settings/client')) || {};
  } catch {
    return {};
  }
}

async function fetchProviders(): Promise<IProvider[]> {
  try {
    return (await httpRequest<IProvider[]>('GET', '/api/providers')) || [];
  } catch (error) {
    console.warn('[Migration] MCP bootstrap could not load providers for image generation env resolution', error);
    return [];
  }
}

export function resolveImageGenerationMigrationConfig(
  backendPrefs: BackendClientPreferences,
  fileConfig?: ImageGenerationModelSetting
): ImageGenerationModelSetting | undefined {
  const backendConfig = backendPrefs['tools.imageGenerationModel'];
  if (backendConfig && typeof backendConfig === 'object') {
    return backendConfig as ImageGenerationModelSetting;
  }
  return fileConfig;
}

function resolveImageGenerationMigrationConfigSource(
  backendPrefs: BackendClientPreferences,
  fileConfig?: ImageGenerationModelSetting
): 'backend' | 'file' | 'none' {
  const backendConfig = backendPrefs['tools.imageGenerationModel'];
  if (backendConfig && typeof backendConfig === 'object') {
    return 'backend';
  }
  return fileConfig ? 'file' : 'none';
}

function logImageGenerationEnvResolution(
  result: ImageGenerationMcpEnvResolveResult,
  context: 'bootstrap' | 'update'
): void {
  if (result.ok === true) {
    console.info(
      '[Migration] image MCP env resolved via %s during %s, provider id: %s, platform: %s, model: %s, api key present: %s',
      result.source,
      context,
      result.provider.id,
      result.provider.platform,
      result.model,
      result.provider.api_key ? 'yes' : 'no'
    );
    return;
  }

  console.warn(
    '[Migration] image MCP env resolution failed during %s, reason: %s, message: %s, candidates: %s',
    context,
    result.reason,
    result.message,
    result.candidates?.join(',') || 'none'
  );
}

function buildBuiltinImageGenerationServer(
  resolution: ImageGenerationMcpEnvResolveResult,
  config?: ImageGenerationModelSetting
): McpImportServer {
  const scriptPath = getBuiltinMcpScriptPath('builtin-mcp-image-gen');
  const env = resolution.ok ? resolution.env : {};
  const serverConfig = {
    command: 'node',
    args: [scriptPath],
    env,
  };

  return {
    name: BUILTIN_IMAGE_GEN_NAME,
    description: 'Built-in image generation tool powered by AI models. Configure the model in Settings > Tools.',
    enabled: config?.switch === true && resolution.ok,
    builtin: true,
    transport: {
      type: 'stdio',
      command: 'node',
      args: [scriptPath],
      env,
    },
    original_json: JSON.stringify({ mcpServers: { [BUILTIN_IMAGE_GEN_NAME]: serverConfig } }, null, 2),
  };
}

function areStringArraysEqual(left?: string[], right?: string[]): boolean {
  const leftValue = left || [];
  const rightValue = right || [];
  return leftValue.length === rightValue.length && leftValue.every((item, index) => item === rightValue[index]);
}

function areStringRecordsEqual(left?: Record<string, string>, right?: Record<string, string>): boolean {
  const leftValue = left || {};
  const rightValue = right || {};
  const leftKeys = Object.keys(leftValue).toSorted();
  const rightKeys = Object.keys(rightValue).toSorted();
  return areStringArraysEqual(leftKeys, rightKeys) && leftKeys.every((key) => leftValue[key] === rightValue[key]);
}

function isSameStdioTransport(left: IMcpServer['transport'], right: IMcpServer['transport']): boolean {
  return (
    left.type === 'stdio' &&
    right.type === 'stdio' &&
    left.command === right.command &&
    areStringArraysEqual(left.args, right.args) &&
    areStringRecordsEqual(left.env, right.env)
  );
}

/**
 * A Chromium browser the user has, preferring the one they browse in.
 *
 * Only the default-handler question matters here — a browser they never open
 * has none of their sessions, which is the whole reason to drive theirs. Read
 * from the registry rather than guessed, and `null` when nothing is found: a
 * wrong path is worse than no path, because the package would fail to launch
 * instead of falling back to its own default.
 */
function findInstalledChromium(): string | null {
  const home = process.env.LOCALAPPDATA ?? '';
  const programFiles = process.env.ProgramFiles ?? '';
  const candidates = [
    path.join(home, 'Programs', 'Opera', 'opera.exe'),
    path.join(home, 'Programs', 'Opera GX', 'opera.exe'),
    path.join(programFiles, 'Opera', 'opera.exe'),
  ];

  return candidates.find((candidate) => candidate.length > 0 && existsSync(candidate)) ?? null;
}

function buildDefaultMcpServers(): McpImportServer[] {
  // Whichever Chromium browser the user actually has, not whichever one the
  // package looks for. `chrome-devtools-mcp` drives Chrome by default and takes
  // `--executablePath` for anything else built on Chromium — Opera, Edge, Brave,
  // Vivaldi. Driving the browser the user already lives in is the difference
  // between acting as them, with their sessions, and acting in a stranger's
  // empty profile.
  //
  // Nothing is passed when no other Chromium is found, which leaves the package
  // on its own default.
  const chromium = findInstalledChromium();
  const chromeConfig = {
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest', ...(chromium ? ['--executablePath', chromium] : [])],
  };

  // The in-app browser, as tools. Unlike chrome-devtools this needs nothing
  // installed — the script ships with the app.
  //
  // **On by default since 2.5.10.** It was off, and the comment here gave the
  // reason: it "acts inside a browser that holds their logins". That was true
  // when the thing being driven was the user's visible panel. Since 2.5.8 it
  // drives the agent's own offscreen page (`process/browser/agentPage.ts`) —
  // nothing it opens, clicks or scrolls appears in front of the user. What it
  // still shares is the `persist:fool-browser` partition, so it acts as the
  // user on sites they are signed into; that is the actual trade-off, and it
  // is the point of the feature rather than an accident of it.
  //
  // The cost of leaving it off was not a missing tool but a false sentence:
  // the assistant told the user it had no browser, which is what an empty tool
  // list looks like from the inside. A capability the app ships and hides is
  // worse than one it does not have.
  const handshake = browserControlHandshakePath();
  const browserScript = getBuiltinMcpScriptPath('builtin-mcp-browser');
  const browserEnv = { FOOL_BROWSER_HANDSHAKE: handshake };
  const browserConfig = { command: 'node', args: [browserScript], env: browserEnv };

  // Offered only when the handshake path is known. Registering it without one
  // would put a server in the user's list that can never reach the browser and
  // has no way to say why.
  const browserServers: McpImportServer[] = handshake
    ? [
        {
          name: BUILTIN_BROWSER_NAME,
          description:
            "Drive The Fool's own background browser: open pages, read them, click and type. Runs offscreen, so nothing appears in front of the user.",
          enabled: true,
          builtin: true,
          transport: { type: 'stdio', command: 'node', args: [browserScript], env: browserEnv },
          original_json: JSON.stringify({ mcpServers: { [BUILTIN_BROWSER_NAME]: browserConfig } }, null, 2),
        },
      ]
    : [];

  const settingsHandshake = browserControlHandshakePath().replace('browser-control.json', 'settings-control.json');
  const settingsScript = getBuiltinMcpScriptPath('builtin-mcp-app-settings');
  const settingsEnv = { FOOL_SETTINGS_HANDSHAKE: settingsHandshake };
  const settingsConfig = { command: 'node', args: [settingsScript], env: settingsEnv };

  const settingsServers: McpImportServer[] = settingsHandshake
    ? [
        {
          name: BUILTIN_APP_SETTINGS_NAME,
          description: "Change The Fool's application settings in real time.",
          enabled: true,
          builtin: true,
          transport: { type: 'stdio', command: 'node', args: [settingsScript], env: settingsEnv },
          original_json: JSON.stringify({ mcpServers: { [BUILTIN_APP_SETTINGS_NAME]: settingsConfig } }, null, 2),
        },
      ]
    : [];

  // PDFs, through the pdf-lib this application already carries. Nothing to
  // install and nothing to detect, so it is always registered and on: the
  // builtin `pdf` skill it supersedes was written against Python and pypdf,
  // whose presence nothing ever checked.
  const pdfScript = getBuiltinMcpScriptPath('builtin-mcp-pdf');
  const pdfConfig = { command: 'node', args: [pdfScript] };
  const pdfServers: McpImportServer[] = [
    {
      name: BUILTIN_PDF_NAME,
      description: 'Read, merge, split, rotate and trim PDFs. The original document is never written over.',
      enabled: true,
      builtin: true,
      transport: { type: 'stdio', command: 'node', args: [pdfScript] },
      original_json: JSON.stringify({ mcpServers: { [BUILTIN_PDF_NAME]: pdfConfig } }, null, 2),
    },
  ];

  // Word, Excel and PowerPoint, through the officecli binary this build ships.
  // Registered **only** when that binary is actually on disk. A server in the
  // user's list that cannot start is a tool list the model reads and believes,
  // and a failure it discovers in the middle of somebody's work — which is
  // exactly what the previous arrangement produced, because officecli was
  // fetched from the internet on first use and might never arrive.
  const office = officeServerCommand();
  const officeServers: McpImportServer[] = office
    ? [
        {
          name: BUILTIN_OFFICE_NAME,
          description: 'Create and edit Word, Excel and PowerPoint documents. Ships with the app; nothing to install.',
          enabled: true,
          builtin: true,
          transport: { type: 'stdio', command: office.command, args: office.args },
          original_json: JSON.stringify({ mcpServers: { [BUILTIN_OFFICE_NAME]: office } }, null, 2),
        },
      ]
    : [];

  const computerUseConfig = {
    command: 'npx',
    args: ['-y', '@betrayzl/windows-computer-use-mcp@latest'],
  };

  return [
    ...browserServers,
    ...settingsServers,
    ...pdfServers,
    ...officeServers,
    {
      name: BUILTIN_CHROME_DEVTOOLS_NAME,
      description: 'Default MCP server: chrome-devtools',
      enabled: false,
      builtin: true,
      transport: {
        type: 'stdio',
        command: chromeConfig.command,
        args: chromeConfig.args,
      },
      original_json: JSON.stringify({ mcpServers: { [BUILTIN_CHROME_DEVTOOLS_NAME]: chromeConfig } }, null, 2),
    },
    {
      name: BUILTIN_COMPUTER_USE_NAME,
      description: 'Default MCP server: computer-use (Allows AI to control screen, mouse and keyboard)',
      enabled: true,
      builtin: true,
      transport: {
        type: 'stdio',
        command: computerUseConfig.command,
        args: computerUseConfig.args,
      },
      original_json: JSON.stringify({ mcpServers: { [BUILTIN_COMPUTER_USE_NAME]: computerUseConfig } }, null, 2),
    },
  ];
}

async function isCommandAvailable(command: string): Promise<boolean> {
  return await new Promise((resolve) => {
    import('child_process').then(({ exec }) => {
      exec(`${command} --version`, { timeout: 3000 }, (error) => {
        if (!error) {
          resolve(true);
          return;
        }

        const err = error as unknown as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
          resolve(false);
          return;
        }

        resolve(true);
      });
    });
  });
}

async function ensureBuiltinChromeDevtoolsAvailability(server?: IMcpServer): Promise<void> {
  if (
    !server ||
    server.name !== BUILTIN_CHROME_DEVTOOLS_NAME ||
    server.transport.type !== 'stdio' ||
    server.transport.command !== 'npx'
  ) {
    return;
  }

  const hasNpx = await isCommandAvailable(server.transport.command);
  if (hasNpx) {
    return;
  }

  try {
    await mcpService.testMcpConnection.invoke(server);
  } catch (error) {
    console.warn('[Migration] chrome-devtools MCP preflight failed', error);
  }
}

function buildOriginalJsonFromTransport(server: Pick<IMcpServer, 'name' | 'description' | 'transport'>): string {
  const transport_config =
    server.transport.type === 'stdio'
      ? {
          command: server.transport.command,
          args: server.transport.args || [],
          env: server.transport.env || {},
        }
      : {
          type: server.transport.type,
          url: server.transport.url,
          ...(server.transport.headers ? { headers: server.transport.headers } : {}),
        };

  return JSON.stringify(
    {
      mcpServers: {
        [server.name]: {
          ...(server.description ? { description: server.description } : {}),
          ...transport_config,
        },
      },
    },
    null,
    2
  );
}

/**
 * Builtin servers that were shipped and are no longer wanted.
 *
 * The bootstrap only ever adds: `missing` is the defaults that are not in the
 * database yet, and nothing walks the other way. So taking an entry out of
 * `buildDefaultMcpServers` spares new installations and leaves every existing
 * one carrying it forever, which is not what "remove it" means.
 *
 * `uacc-computer-control` is the first of these. It drove the screen through a
 * Python sidecar at `c:\Fool-AionUI\uacc-sidecar` — an absolute path on one
 * developer's machine, shipped as a builtin — and the user asked for the
 * capability itself to go, not to be switched off. Work on the computer belongs
 * to the tools that do it in the background.
 */
const RETIRED_BUILTIN_MCP_SERVERS: ReadonlySet<string> = new Set(['uacc-computer-control']);

/**
 * Deletes them, once, and never resurrects them.
 *
 * By name rather than by id because the name is what identifies a builtin here,
 * and a failure to delete one is not a reason to stop the app starting: it is
 * retried on the next launch, which is the same guarantee the rest of this
 * bootstrap gives.
 */
async function removeRetiredBuiltinServers(existing: readonly IMcpServer[]): Promise<void> {
  const retired = existing.filter((server) => RETIRED_BUILTIN_MCP_SERVERS.has(server.name));
  if (retired.length === 0) return;

  for (const server of retired) {
    try {
      await mcpService.deleteServer.invoke({ id: server.id });
      console.log(`[Migration] removed retired builtin MCP server: ${server.name}`);
    } catch (error) {
      console.warn(`[Migration] could not remove ${server.name}:`, error);
    }
  }
}

/**
 * Switches the builtin browser on for an installation that predates the change.
 *
 * The bootstrap below only ever adds — `missing` is the defaults the database
 * does not have, and nothing walks the other way. So flipping `enabled` in
 * {@link buildDefaultMcpServers} reaches a fresh install and nobody else, which
 * is the shape of change that looks done and does nothing. This is the other
 * half.
 *
 * Run once and recorded, so a user who turns it back off is not overruled on
 * the next launch. The flag is written even when there is nothing to change,
 * because "already on" and "switched on" are the same state afterwards and
 * neither should be revisited.
 */
async function enableBuiltinBrowserOnce(configFile: ConfigFile, existing: readonly IMcpServer[]): Promise<void> {
  const done = await configFile.get('migration.browserEnabledByDefault_v1').catch((): undefined => undefined);
  if (done) return;

  const browser = existing.find((server) => server.name === BUILTIN_BROWSER_NAME);
  // Nothing to migrate: a fresh install gets it enabled from the defaults, and
  // the flag would be recorded against a decision never taken.
  if (!browser) return;

  // `toggleServer` flips, it does not set — so the check above is what keeps
  // this from switching off a browser that is already on. There is no
  // set-enabled route: `updateServer` takes name, transport, description,
  // original_json and builtin, and nothing else.
  if (browser.enabled !== true) {
    try {
      await mcpService.toggleServer.invoke({ id: browser.id });
      console.log(`[Migration] enabled builtin MCP server: ${BUILTIN_BROWSER_NAME}`);
    } catch (error) {
      // Left unflagged so the next launch tries again, which is the same
      // guarantee the rest of this bootstrap gives.
      console.warn(`[Migration] could not enable ${BUILTIN_BROWSER_NAME}:`, error);
      return;
    }
  }

  await configFile.set('migration.browserEnabledByDefault_v1', true).catch((error: unknown) => {
    console.warn('[Migration] could not record the browser migration flag:', error);
  });
}

async function ensureBootstrapMcpServersInDb(configFile: ConfigFile): Promise<void> {
  const [backendPrefs, fileImageConfig, providers] = await Promise.all([
    fetchBackendClientPreferences(),
    configFile.get('tools.imageGenerationModel').catch((): undefined => undefined),
    fetchProviders(),
  ]);
  const imageConfig = resolveImageGenerationMigrationConfig(backendPrefs, fileImageConfig);
  const imageConfigSource = resolveImageGenerationMigrationConfigSource(backendPrefs, fileImageConfig);
  const existing = await mcpService.listServers.invoke();
  const existingByName = new Map((existing ?? []).map((server) => [server.name, server]));
  const existingImageServer = existingByName.get(BUILTIN_IMAGE_GEN_NAME);
  const existingImageEnv =
    existingImageServer?.transport.type === 'stdio' ? existingImageServer.transport.env : undefined;
  const imageEnvResolution = resolveImageGenerationMcpEnv(imageConfig, providers, existingImageEnv);
  logImageGenerationEnvResolution(imageEnvResolution, 'bootstrap');
  const imageServer = buildBuiltinImageGenerationServer(imageEnvResolution, imageConfig);
  const defaultServers = buildDefaultMcpServers();
  const missing = [...defaultServers, imageServer].filter((server) => !existingByName.has(server.name));
  let imageServerUpdated = false;

  if (missing.length > 0) {
    await mcpService.batchImportServers.invoke({ servers: missing });
  }

  await removeRetiredBuiltinServers(existing ?? []);
  await enableBuiltinBrowserOnce(configFile, existing ?? []);

  const existingChromeDevtools = existingByName.get(BUILTIN_CHROME_DEVTOOLS_NAME);
  if (
    existingChromeDevtools &&
    (existingChromeDevtools.builtin !== true ||
      !existingChromeDevtools.original_json ||
      existingChromeDevtools.original_json.trim() === '' ||
      existingChromeDevtools.original_json.trim() === '{}')
  ) {
    await mcpService.updateServer.invoke({
      id: existingChromeDevtools.id,
      data: {
        builtin: true,
        original_json: buildOriginalJsonFromTransport(existingChromeDevtools),
      },
    });
  }

  const refreshedServers = await mcpService.listServers.invoke();
  const chromeDevtoolsServer = refreshedServers.find((server) => server.name === BUILTIN_CHROME_DEVTOOLS_NAME);
  await ensureBuiltinChromeDevtoolsAvailability(chromeDevtoolsServer);

  if (
    imageEnvResolution.ok === true &&
    existingImageServer &&
    existingImageServer.transport.type === 'stdio' &&
    imageServer.transport.type === 'stdio'
  ) {
    const mergedEnv = {
      ...removeImageGenerationEnvKeys(existingImageServer.transport.env || {}),
      ...imageEnvResolution.env,
    };
    const updatedTransport = {
      ...imageServer.transport,
      env: mergedEnv,
    };
    const original_json = JSON.stringify(
      {
        mcpServers: {
          [BUILTIN_IMAGE_GEN_NAME]: {
            command: updatedTransport.command,
            args: updatedTransport.args || [],
            env: mergedEnv,
          },
        },
      },
      null,
      2
    );
    const imageTransportChanged = !isSameStdioTransport(existingImageServer.transport, updatedTransport);
    const imageOriginalJsonChanged = existingImageServer.original_json !== original_json;
    const imageServerChanged = imageTransportChanged || imageOriginalJsonChanged;
    console.info(
      '[Migration] image MCP bootstrap decision, server id: %s, transport changed: %s, json changed: %s, will update: %s',
      existingImageServer.id,
      imageTransportChanged ? 'yes' : 'no',
      imageOriginalJsonChanged ? 'yes' : 'no',
      imageServerChanged ? 'yes' : 'no'
    );
    if (imageServerChanged) {
      await mcpService.updateServer.invoke({
        id: existingImageServer.id,
        data: {
          transport: updatedTransport,
          original_json,
        },
      });
      imageServerUpdated = true;
    }
  } else if (existingImageServer && imageEnvResolution.ok === false) {
    console.warn(
      '[Migration] skipped image MCP env update because provider could not be resolved, server id: %s, reason: %s',
      existingImageServer.id,
      imageEnvResolution.reason
    );
  }

  console.info(
    '[Migration] MCP bootstrap completed, imported %d missing defaults, updated image server: %s, image config source: %s, image enabled: %s',
    missing.length,
    imageServerUpdated ? 'yes' : 'no',
    imageConfigSource,
    imageConfig?.switch === true ? 'yes' : 'no'
  );
}

const MIGRATION_STEPS: Array<{
  name: string;
  run: (configFile: ConfigFile) => Promise<MigrationStepResult>;
}> = [
  {
    name: 'migrateLegacyMcpConfigToDb',
    run: async (configFile) => (await migrateLegacyMcpConfigToDb(configFile), true),
  },
  { name: 'migrateConfigStorage', run: async (configFile) => (await migrateConfigStorage(configFile), true) },
  { name: 'migrateProviders', run: async (configFile) => (await migrateProviders(configFile), true) },
  {
    name: 'ensureBootstrapMcpServersInDb',
    run: async (configFile) => (await ensureBootstrapMcpServersInDb(configFile), true),
  },
  {
    name: 'discoverAndRegisterLocalProviders',
    run: async () => (await discoverAndRegisterLocalProviders(), true),
  },
  {
    name: 'refreshLmStudioModels',
    run: async () => (await refreshLmStudioModels(), true),
  },
  { name: 'migrateAssistantsToBackend', run: async (configFile) => migrateAssistantsToBackend(configFile) },
];

async function syncBuiltinMcpConfig(configFile: ConfigFile): Promise<void> {
  const localMcpConfig = ((await configFile.get('mcp.config').catch((): IMcpServer[] => [])) || []) as IMcpServer[];
  const localBuiltinServers = localMcpConfig.filter((server) => server?.builtin === true);

  if (localBuiltinServers.length === 0) {
    return;
  }

  const backendSettings = (await httpRequest<Record<string, unknown>>('GET', '/api/settings/client')) || {};
  const backendMcpConfig = Array.isArray(backendSettings['mcp.config'])
    ? (backendSettings['mcp.config'] as IMcpServer[])
    : [];

  const mergedMcpConfig = [...backendMcpConfig.filter((server) => server?.builtin !== true), ...localBuiltinServers];

  if (JSON.stringify(backendMcpConfig) === JSON.stringify(mergedMcpConfig)) {
    return;
  }

  await httpRequest<void>('PUT', '/api/settings/client', { 'mcp.config': mergedMcpConfig });
  console.info(
    '[The Fool] Synced builtin MCP config to backend settings (%d builtin servers)',
    localBuiltinServers.length
  );
}

export async function runBackendMigrations(configFile: ConfigFile): Promise<void> {
  await CLEANUP_STEPS.reduce<Promise<void>>(async (previous, step) => {
    await previous;
    const start = Date.now();
    try {
      await step.run();
      console.info(`[The Fool] Backend migration step completed: ${step.name} (${Date.now() - start}ms)`);
    } catch (error) {
      console.error(`[The Fool] Backend migration step failed: ${step.name} (${Date.now() - start}ms)`, error);
    }
  }, Promise.resolve());

  await MIGRATION_STEPS.reduce<Promise<void>>(async (previous, step) => {
    await previous;
    const start = Date.now();
    try {
      const completed = await step.run(configFile);
      const elapsed = Date.now() - start;
      if (!completed) {
        console.warn(`[The Fool] Backend migration step incomplete: ${step.name} (${elapsed}ms)`);
        return;
      }
      console.info(`[The Fool] Backend migration step completed: ${step.name} (${elapsed}ms)`);
    } catch (error) {
      const elapsed = Date.now() - start;
      console.error(`[The Fool] Backend migration step failed: ${step.name} (${elapsed}ms)`, error);
    }
  }, Promise.resolve());

  const syncStart = Date.now();
  try {
    await syncBuiltinMcpConfig(configFile);
    console.info(`[The Fool] Backend migration step completed: syncBuiltinMcpConfig (${Date.now() - syncStart}ms)`);
  } catch (error) {
    console.error(
      `[The Fool] Backend migration step failed: syncBuiltinMcpConfig (${Date.now() - syncStart}ms)`,
      error
    );
  }
}
