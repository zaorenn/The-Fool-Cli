# Local Model Discovery and Built-in Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every installed LM Studio model in the model picker, put an always-available hands-free conversation control in the composer, and give The Fool a dedicated built-in Voice settings category with natural English speech and local voice cloning.

**Architecture:** The voice backend is already complete and wired — `FoolVoiceService`, `SherpaVoiceProvider`, `VoiceModelManager`, and the `ipcBridge.foolVoice.*` envelope bridge all exist and are registered in `initBridge.ts`. This plan adds (1) a main-process LM Studio model source that publishes the full model list into `IProvider.models`, and (2) the missing renderer half of voice: microphone capture, VAD, a turn driver, and the settings surface. No new runtime dependency is added; Kokoro and ZipVoice are already compiled into the pinned `sherpa-onnx-node@1.13.4`.

**Tech Stack:** Electron 37, React 19, TypeScript 5.8 strict, Arco Design, UnoCSS, Vitest 4, `sherpa-onnx-node@1.13.4`.

**Spec:** `docs/specs/2026-07-29-the-fool-local-models-and-builtin-voice-design.md`

## Global Constraints

- Work only in `C:\Fool-The Fool` on `feat/the-fool-windows-alpha`; never modify `C:\Fool`.
- No `any`. The existing `as any` casts in `initBridge.ts` are pre-existing; do not add more and do not expand scope to remove them.
- Renderer code uses no Node APIs; main-process code uses no DOM APIs. Cross-process calls go through `ipcBridge`.
- Arco components only for interactive UI — no raw `<button>`, `<input>`, `<select>`.
- Every new user-facing string uses an i18n key added to all locale directories in `packages/desktop/src/common/config/i18n-config.json`.
- Keep each directory at ten or fewer direct children.
- Each behavior change starts with a failing test; each `describe` includes at least one failure path.
- Never log microphone audio, reference samples, API keys, or model file contents.
- Do not push. Do not build installers — packaging is deferred (spec §2.2).
- Zero regression: no control that exists today may become unreachable. This is verified in Task 6 for the controls this plan moves, not by a full upstream audit.

**Ordering note:** Tasks 1–2 (LM Studio) are independent of Tasks 3–7 (voice) and are testable on their own. Run them first so the model picker fix can be verified before the voice work lands.

---

## Task 1: LM Studio model readers

**Files:**

- Create: `packages/desktop/src/process/services/local-models/lmsCli.ts`
- Create: `packages/desktop/src/process/services/local-models/modelDirScan.ts`
- Test: `tests/unit/process/services/localModels/lmsCli.test.ts`
- Test: `tests/unit/process/services/localModels/modelDirScan.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `type LocalModelEntry = { id: string; displayName: string; contextLength: number | null; toolUse: boolean }`
  - `readLmsCliModels(options: { execFile: ExecFileFn; homeDir: string }): Promise<LocalModelEntry[] | null>` — `null` means this tier could not answer.
  - `scanModelDirectory(options: { fs: ScanFs; root: string }): Promise<LocalModelEntry[] | null>`
  - `type ExecFileFn = (file: string, args: string[], options: { timeout: number }) => Promise<{ stdout: string }>`
  - `type ScanFs = { readdir: (p: string) => Promise<{ name: string; isDirectory: boolean }[]> }`

Both take their I/O as injected parameters so tests need no real filesystem or child process.

- [ ] **Step 1: Write the failing tests for `lmsCli`**

```ts
// tests/unit/process/services/localModels/lmsCli.test.ts
import { describe, expect, it, vi } from 'vitest';
import { readLmsCliModels } from '@process/services/local-models/lmsCli';

const ok = (stdout: string) => vi.fn().mockResolvedValue({ stdout });

describe('readLmsCliModels', () => {
  it('returns every llm and vlm entry', async () => {
    const execFile = ok(
      JSON.stringify([
        {
          type: 'llm',
          modelKey: 'qwen/qwen3-14b',
          displayName: 'Qwen3 14B',
          maxContextLength: 40960,
          trainedForToolUse: true,
        },
        {
          type: 'vlm',
          modelKey: 'google/gemma-4-e4b',
          displayName: 'Gemma 4',
          maxContextLength: 8192,
          trainedForToolUse: false,
        },
      ])
    );

    const models = await readLmsCliModels({ execFile, homeDir: 'C:/Users/x' });

    expect(models).toEqual([
      { id: 'qwen/qwen3-14b', displayName: 'Qwen3 14B', contextLength: 40960, toolUse: true },
      { id: 'google/gemma-4-e4b', displayName: 'Gemma 4', contextLength: 8192, toolUse: false },
    ]);
  });

  it('excludes embedding models', async () => {
    const execFile = ok(
      JSON.stringify([
        { type: 'embedding', modelKey: 'nomic-embed-text' },
        { type: 'llm', modelKey: 'qwen/qwen3-14b' },
      ])
    );

    const models = await readLmsCliModels({ execFile, homeDir: 'C:/Users/x' });

    expect(models?.map((m) => m.id)).toEqual(['qwen/qwen3-14b']);
  });

  it('skips entries with no usable modelKey instead of failing the whole read', async () => {
    const execFile = ok(
      JSON.stringify([{ type: 'llm' }, { type: 'llm', modelKey: '' }, { type: 'llm', modelKey: 'a' }])
    );

    const models = await readLmsCliModels({ execFile, homeDir: 'C:/Users/x' });

    expect(models?.map((m) => m.id)).toEqual(['a']);
  });

  it('returns null when the output is not JSON', async () => {
    expect(await readLmsCliModels({ execFile: ok('not json'), homeDir: 'C:/Users/x' })).toBeNull();
  });

  it('returns null when the executable is missing', async () => {
    const execFile = vi.fn().mockRejectedValue(new Error('ENOENT'));
    expect(await readLmsCliModels({ execFile, homeDir: 'C:/Users/x' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bunx vitest run tests/unit/process/services/localModels/lmsCli.test.ts`
Expected: FAIL — module `@process/services/local-models/lmsCli` not found.

- [ ] **Step 3: Implement `lmsCli.ts`**

```ts
/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type LocalModelEntry = {
  id: string;
  displayName: string;
  contextLength: number | null;
  toolUse: boolean;
};

export type ExecFileFn = (file: string, args: string[], options: { timeout: number }) => Promise<{ stdout: string }>;

const CLI_TIMEOUT_MS = 5000;
const USABLE_TYPES = new Set(['llm', 'vlm']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toEntry = (raw: unknown): LocalModelEntry | null => {
  if (!isRecord(raw)) return null;
  if (typeof raw.type !== 'string' || !USABLE_TYPES.has(raw.type)) return null;
  const id = raw.modelKey;
  if (typeof id !== 'string' || id.length === 0) return null;
  return {
    id,
    displayName: typeof raw.displayName === 'string' && raw.displayName.length > 0 ? raw.displayName : id,
    contextLength: typeof raw.maxContextLength === 'number' ? raw.maxContextLength : null,
    toolUse: raw.trainedForToolUse === true,
  };
};

const candidates = (homeDir: string): string[] => [
  `${homeDir}/.lmstudio/bin/lms.exe`,
  `${homeDir}/.lmstudio/bin/lms`,
  'lms',
];

export const readLmsCliModels = async (options: {
  execFile: ExecFileFn;
  homeDir: string;
}): Promise<LocalModelEntry[] | null> => {
  for (const file of candidates(options.homeDir)) {
    let stdout: string;
    try {
      ({ stdout } = await options.execFile(file, ['ls', '--json'], { timeout: CLI_TIMEOUT_MS }));
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) return null;
    return parsed.map(toEntry).filter((entry): entry is LocalModelEntry => entry !== null);
  }
  return null;
};
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bunx vitest run tests/unit/process/services/localModels/lmsCli.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing tests for `modelDirScan`**

```ts
// tests/unit/process/services/localModels/modelDirScan.test.ts
import { describe, expect, it, vi } from 'vitest';
import { scanModelDirectory } from '@process/services/local-models/modelDirScan';

const tree: Record<string, { name: string; isDirectory: boolean }[]> = {
  '/models': [{ name: 'qwen', isDirectory: true }],
  '/models/qwen': [{ name: 'Qwen3-14B-GGUF', isDirectory: true }],
  '/models/qwen/Qwen3-14B-GGUF': [
    { name: 'Qwen3-14B-Q4_K_M.gguf', isDirectory: false },
    { name: 'mmproj-Qwen3-14B-BF16.gguf', isDirectory: false },
    { name: 'README.md', isDirectory: false },
  ],
};

const fs = { readdir: vi.fn(async (p: string) => tree[p] ?? []) };

describe('scanModelDirectory', () => {
  it('finds nested gguf models and excludes mmproj projectors and non-gguf files', async () => {
    const models = await scanModelDirectory({ fs, root: '/models' });

    expect(models).toEqual([
      {
        id: 'qwen/Qwen3-14B-GGUF/Qwen3-14B-Q4_K_M.gguf',
        displayName: 'Qwen3-14B-Q4_K_M',
        contextLength: null,
        toolUse: false,
      },
    ]);
  });

  it('returns null when the root cannot be read', async () => {
    const failing = { readdir: vi.fn().mockRejectedValue(new Error('EACCES')) };
    expect(await scanModelDirectory({ fs: failing, root: '/models' })).toBeNull();
  });

  it('stops at the file cap instead of walking an unbounded tree', async () => {
    const many = Array.from({ length: 3000 }, (_, i) => ({ name: `m${i}.gguf`, isDirectory: false }));
    const bigFs = { readdir: vi.fn(async () => many) };

    const models = await scanModelDirectory({ fs: bigFs, root: '/models' });

    expect(models?.length).toBe(2000);
  });
});
```

- [ ] **Step 6: Run the tests and confirm they fail**

Run: `bunx vitest run tests/unit/process/services/localModels/modelDirScan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `modelDirScan.ts`**

```ts
/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LocalModelEntry } from './lmsCli';

export type ScanFs = {
  readdir: (path: string) => Promise<{ name: string; isDirectory: boolean }[]>;
};

const MAX_DEPTH = 3;
const MAX_FILES = 2000;

export const scanModelDirectory = async (options: { fs: ScanFs; root: string }): Promise<LocalModelEntry[] | null> => {
  const found: LocalModelEntry[] = [];

  const walk = async (path: string, relative: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;
    const entries = await options.fs.readdir(path);
    for (const entry of entries) {
      if (found.length >= MAX_FILES) return;
      const nextRelative = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(`${path}/${entry.name}`, nextRelative, depth + 1);
        continue;
      }
      if (!entry.name.endsWith('.gguf') || entry.name.startsWith('mmproj-')) continue;
      found.push({
        id: nextRelative,
        displayName: entry.name.slice(0, -'.gguf'.length),
        contextLength: null,
        toolUse: false,
      });
    }
  };

  try {
    await walk(options.root, '', 1);
  } catch {
    return null;
  }
  return found;
};
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `bunx vitest run tests/unit/process/services/localModels/`
Expected: PASS, 8 tests.

- [ ] **Step 9: Commit**

```bash
git add packages/desktop/src/process/services/local-models tests/unit/process/services/localModels
git commit -m "feat(models): read installed LM Studio models"
```

---

## Task 2: Publish the complete model list to the provider

**Files:**

- Create: `packages/desktop/src/process/services/local-models/LmStudioModelSource.ts`
- Create: `packages/desktop/src/process/services/local-models/index.ts`
- Move: `packages/desktop/src/process/utils/localProviderDiscovery.ts` → `packages/desktop/src/process/services/local-models/LocalProviderRegistrar.ts`
- Modify: `packages/desktop/src/process/utils/runBackendMigrations.ts:11`
- Test: `tests/unit/process/services/localModels/lmStudioModelSource.test.ts`

**Interfaces:**

- Consumes: `readLmsCliModels`, `scanModelDirectory`, `LocalModelEntry` from Task 1.
- Produces:
  - `type ModelListTier = 'complete' | 'complete-degraded' | 'loaded-only' | 'unavailable'`
  - `type ModelListResult = { tier: ModelListTier; models: LocalModelEntry[] }`
  - `resolveLmStudioModels(deps: LmStudioSourceDeps): Promise<ModelListResult>`
  - `isLmStudioProvider(baseUrl: string, port: number): boolean`
  - `publishLmStudioModels(deps): Promise<void>` from `LocalProviderRegistrar.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/process/services/localModels/lmStudioModelSource.test.ts
import { describe, expect, it, vi } from 'vitest';
import { isLmStudioProvider, resolveLmStudioModels } from '@process/services/local-models/LmStudioModelSource';

const entry = (id: string) => ({ id, displayName: id, contextLength: null, toolUse: false });

const deps = (over: Partial<Parameters<typeof resolveLmStudioModels>[0]> = {}) => ({
  readCli: vi.fn().mockResolvedValue(null),
  scanDir: vi.fn().mockResolvedValue(null),
  readHttp: vi.fn().mockResolvedValue(null),
  modelsRoot: vi.fn().mockResolvedValue('/models'),
  ...over,
});

describe('resolveLmStudioModels', () => {
  it('reports tier complete when the cli answers', async () => {
    const result = await resolveLmStudioModels(deps({ readCli: vi.fn().mockResolvedValue([entry('a')]) }));
    expect(result).toEqual({ tier: 'complete', models: [entry('a')] });
  });

  it('falls back to the directory scan and reports complete-degraded', async () => {
    const result = await resolveLmStudioModels(deps({ scanDir: vi.fn().mockResolvedValue([entry('b')]) }));
    expect(result).toEqual({ tier: 'complete-degraded', models: [entry('b')] });
  });

  it('falls back to http and reports loaded-only', async () => {
    const result = await resolveLmStudioModels(deps({ readHttp: vi.fn().mockResolvedValue([entry('c')]) }));
    expect(result).toEqual({ tier: 'loaded-only', models: [entry('c')] });
  });

  it('reports unavailable with no models when every tier fails', async () => {
    expect(await resolveLmStudioModels(deps())).toEqual({ tier: 'unavailable', models: [] });
  });

  it('does not consult lower tiers once a higher tier answers', async () => {
    const d = deps({ readCli: vi.fn().mockResolvedValue([entry('a')]) });
    await resolveLmStudioModels(d);
    expect(d.scanDir).not.toHaveBeenCalled();
    expect(d.readHttp).not.toHaveBeenCalled();
  });
});

describe('isLmStudioProvider', () => {
  it.each(['http://127.0.0.1:1234/v1', 'http://localhost:1234/v1', 'http://[::1]:1234/v1'])(
    'matches loopback host on the configured port: %s',
    (url) => expect(isLmStudioProvider(url, 1234)).toBe(true)
  );

  it('rejects a remote host on the same port', () => {
    expect(isLmStudioProvider('http://10.0.0.5:1234/v1', 1234)).toBe(false);
  });

  it('rejects loopback on a different port', () => {
    expect(isLmStudioProvider('http://127.0.0.1:11434', 1234)).toBe(false);
  });

  it('rejects an unparseable url', () => {
    expect(isLmStudioProvider('not a url', 1234)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bunx vitest run tests/unit/process/services/localModels/lmStudioModelSource.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `LmStudioModelSource.ts`**

```ts
/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LocalModelEntry } from './lmsCli';

export type ModelListTier = 'complete' | 'complete-degraded' | 'loaded-only' | 'unavailable';
export type ModelListResult = { tier: ModelListTier; models: LocalModelEntry[] };

export type LmStudioSourceDeps = {
  readCli: () => Promise<LocalModelEntry[] | null>;
  scanDir: (root: string) => Promise<LocalModelEntry[] | null>;
  readHttp: () => Promise<LocalModelEntry[] | null>;
  modelsRoot: () => Promise<string | null>;
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export const resolveLmStudioModels = async (deps: LmStudioSourceDeps): Promise<ModelListResult> => {
  const fromCli = await deps.readCli();
  if (fromCli) return { tier: 'complete', models: fromCli };

  const root = await deps.modelsRoot();
  if (root) {
    const fromDir = await deps.scanDir(root);
    if (fromDir) return { tier: 'complete-degraded', models: fromDir };
  }

  const fromHttp = await deps.readHttp();
  if (fromHttp) return { tier: 'loaded-only', models: fromHttp };

  return { tier: 'unavailable', models: [] };
};

export const isLmStudioProvider = (baseUrl: string, port: number): boolean => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  return LOOPBACK_HOSTS.has(url.hostname) && url.port === String(port);
};

export const mergeModelIds = (backendModels: readonly string[], discovered: readonly LocalModelEntry[]): string[] =>
  [...new Set([...backendModels, ...discovered.map((model) => model.id)])].sort();
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bunx vitest run tests/unit/process/services/localModels/lmStudioModelSource.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Move the registrar and publish the merged list**

`git mv packages/desktop/src/process/utils/localProviderDiscovery.ts packages/desktop/src/process/services/local-models/LocalProviderRegistrar.ts`

Then add to that file, keeping the existing `discoverAndRegisterLocalProviders` behavior intact and exporting it unchanged:

```ts
import { httpRequest } from '@/common/adapter/httpBridge';
import type { IProvider } from '@/common/config/storage';
import {
  isLmStudioProvider,
  mergeModelIds,
  resolveLmStudioModels,
  type LmStudioSourceDeps,
} from './LmStudioModelSource';

export const publishLmStudioModels = async (deps: {
  source: LmStudioSourceDeps;
  port: number;
  listProviders: () => Promise<IProvider[]>;
  updateProvider: (id: string, models: string[]) => Promise<void>;
}): Promise<void> => {
  const providers = await deps.listProviders();
  const targets = providers.filter((provider) => isLmStudioProvider(provider.base_url, deps.port));
  if (targets.length === 0) return;

  const { models } = await resolveLmStudioModels(deps.source);
  if (models.length === 0) return; // never clear a known list

  for (const provider of targets) {
    const merged = mergeModelIds(provider.models ?? [], models);
    if (merged.length === (provider.models ?? []).length) continue;
    await deps.updateProvider(provider.id, merged);
  }
};
```

Wire the concrete dependencies (`node:child_process` `execFile` promisified, `node:fs/promises` `readdir` with `withFileTypes`, `os.homedir()`, the LM Studio port read from `~/.lmstudio/.internal/http-server-config.json` with fallback `1234`, and `httpRequest` for `PUT /api/providers/:id`) in `index.ts`, and call `publishLmStudioModels` from `runBackendMigrations.ts` right after `discoverAndRegisterLocalProviders`.

- [ ] **Step 6: Update the import in `runBackendMigrations.ts`**

Change line 11 from `./localProviderDiscovery` to `../services/local-models`.

- [ ] **Step 6b: Add the second refresh trigger**

App start alone is not enough — spec §3.3 also requires a refresh when the user activates the existing "fetch models" action for a matched provider. Add `refreshLocalModels: httpPost<void, { providerId: string }>(...)` alongside the existing `mode.*` entries in `ipcBridge.ts`, back it with `publishLmStudioModels`, and call it from the renderer's model-settings fetch handler right after `fetchProviderModels` resolves. Add a test asserting it is a no-op for a provider that is not LM Studio.

- [ ] **Step 6c: Surface the tier so an incomplete list is never shown as complete (spec §6)**

Return the `ModelListTier` from `refreshLocalModels` and, in the Model settings provider view, render an Arco `Alert` when the tier is `loaded-only` ("only currently loaded models could be listed") or `unavailable` ("the model list could not be refreshed; showing the last known list"). Tiers `complete` and `complete-degraded` render no alert. Add a component test for each of the four tiers.

- [ ] **Step 7: Verify types and the full suite**

Run: `bunx tsc --noEmit && bunx vitest run tests/unit/process/`
Expected: no type errors; all process unit tests pass.

- [ ] **Step 8: Manual check against the real machine**

Start the app, open the model picker for the LM Studio provider, and confirm every installed model appears, not only the loaded ones. Cross-check the count against `lms ls`.

- [ ] **Step 9: Commit**

```bash
git add packages/desktop/src/process tests/unit/process
git commit -m "feat(models): publish all installed LM Studio models to the picker"
```

---

## Task 3: Add Kokoro and default speech output to natural English

**Files:**

- Modify: `packages/desktop/src/process/services/fool-voice/VoiceModelCatalog.ts`
- Modify: `packages/desktop/src/common/types/foolVoice.ts` (`DEFAULT_FOOL_VOICE_SETTINGS` and the matching zod defaults)
- Test: `tests/unit/process/foolVoiceModelCatalog.test.ts` (extend)

**Interfaces:**

- Consumes: the existing `VoiceModel` and `ManagedCatalogEntry` contracts.
- Produces: catalog id `tts-kokoro-en-v1` usable as `FoolVoiceSettings['tts']['modelId']`, with profile ids `kokoro-voice-0` … `kokoro-voice-N` matching the shipped voice count.

- [ ] **Step 1: Resolve the real Kokoro release asset before writing code**

Find the Kokoro TTS asset on `https://github.com/k2-fsa/sherpa-onnx/releases` (`tts-models` tag), download it once, and record: exact URL, archive byte size, `sha256`, the extracted file list, and the number of speakers in its `tokens`/config. **Do not invent these values.** If no suitable Kokoro asset exists, stop and report before continuing — do not substitute a different model silently.

- [ ] **Step 2: Write the failing catalog test using the recorded values**

```ts
// append to tests/unit/process/foolVoiceModelCatalog.test.ts
import { MANAGED_CATALOG_ENTRIES, VoiceModelCatalog } from '@process/services/fool-voice/VoiceModelCatalog';

describe('kokoro english tts', () => {
  it('is registered as an installable english text-to-speech model', () => {
    const model = VoiceModelCatalog.getModels().find((m) => m.id === 'tts-kokoro-en-v1');
    expect(model?.role).toBe('text-to-speech');
    expect(model?.languages).toContain('en');
    expect(model?.providerId).toBe('local-sherpa');
  });

  it('has a pinned checksum and a non-empty file manifest', () => {
    const entry = MANAGED_CATALOG_ENTRIES['tts-kokoro-en-v1'];
    expect(entry.url.startsWith('https://github.com/k2-fsa/sherpa-onnx/releases/download/')).toBe(true);
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.expectedFiles.length).toBeGreaterThan(0);
  });

  it('has no managed entry without a catalog model', () => {
    for (const id of Object.keys(MANAGED_CATALOG_ENTRIES)) {
      expect(VoiceModelCatalog.getModels().some((m) => m.id === id)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `bunx vitest run tests/unit/process/foolVoiceModelCatalog.test.ts`
Expected: FAIL — `tts-kokoro-en-v1` not found.

- [ ] **Step 4: Add the catalog entries using the recorded values**

Add a `VoiceModel` with `id: 'tts-kokoro-en-v1'`, `providerId: 'local-sherpa'`, `role: 'text-to-speech'`, `languages: ['en']`, `distribution: 'managed'`, `state: { status: 'not-installed' }`, `audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 }`, and `profileIds` for each shipped voice. Add the matching `MANAGED_CATALOG_ENTRIES` record with the URL, `sha256`, `archiveBytes`, and `expectedFiles` recorded in Step 1.

- [ ] **Step 5: Switch the speech-output defaults to English**

In `DEFAULT_FOOL_VOICE_SETTINGS` and the corresponding zod `.default(...)` values, set `tts.modelId` to `'tts-kokoro-en-v1'`, `tts.profileId` to the first Kokoro profile id, `tts.language` to `'en'`, and `narrator.language` to `'en'`. Leave `stt.language` as `'tr'` and leave the Supertonic entry in place — Turkish replies continue to use it.

- [ ] **Step 6: Implement the Turkish fallback (spec §5.3)**

Changing the default is not the whole requirement: a Turkish reply must still be spoken in Turkish. Add a pure helper `selectTtsTarget(text, settings)` in `packages/desktop/src/renderer/services/voice/selectTtsTarget.ts` returning `{ modelId, profileId, language }`. It returns the Supertonic Turkish target when the text is detected as Turkish **and** that model is installed, and the configured Kokoro target otherwise. Detect Turkish with a cheap check — presence of `ğışçöü` characters or common Turkish suffixes — and prefer the configured default when the signal is ambiguous. Test: English text → Kokoro; Turkish text → Supertonic; Turkish text with Supertonic not installed → Kokoro; empty text → configured default.

- [ ] **Step 7: Run the tests and type check**

Run: `bunx vitest run tests/unit/process/foolVoiceModelCatalog.test.ts tests/unit/common tests/unit/renderer/voice && bunx tsc --noEmit`
Expected: PASS; no type errors. Fix any existing test that asserted the Turkish default — update the assertion, do not delete the test.

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src tests/unit
git commit -m "feat(voice): add natural english speech output"
```

---

## Task 4: Microphone capture and voice activity detection

**Files:**

- Create: `packages/desktop/src/renderer/services/voice/AdaptiveVad.ts`
- Create: `packages/desktop/src/renderer/services/voice/MicrophoneCapture.ts`
- Test: `tests/unit/renderer/voice/adaptiveVad.test.ts`

**Interfaces:**

- Consumes: `FoolVoiceSettings['vad']` from `@/common/types/foolVoice`.
- Produces:
  - `class AdaptiveVad { constructor(config: FoolVoiceSettings['vad']); push(rms: number, nowMs: number): VadEvent }`
  - `type VadEvent = 'idle' | 'calibrating' | 'speech-started' | 'speech' | 'utterance-ended' | 'utterance-truncated'`
  - `class MicrophoneCapture { start(deviceId: string | null): Promise<void>; onFrame(cb: (rms: number, pcm: Float32Array) => void): void; takeUtteranceWav(): VoicePcm16Wav; stop(): void }`

`AdaptiveVad` is pure — it takes an RMS level and a clock reading and returns an event, so it is fully testable without audio hardware.

- [ ] **Step 1: Write the failing VAD tests**

```ts
// tests/unit/renderer/voice/adaptiveVad.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { AdaptiveVad } from '@renderer/services/voice/AdaptiveVad';

const config = {
  calibrationMs: 1000,
  minimumSpeechMs: 250,
  silenceMs: 800,
  maximumUtteranceMs: 30000,
  sensitivity: 0.55,
};

const feed = (vad: AdaptiveVad, rms: number, fromMs: number, toMs: number, stepMs = 50) => {
  let last = 'idle';
  for (let t = fromMs; t <= toMs; t += stepMs) last = vad.push(rms, t);
  return last;
};

describe('AdaptiveVad', () => {
  let vad: AdaptiveVad;
  beforeEach(() => {
    vad = new AdaptiveVad(config);
  });

  it('calibrates on ambient noise before reporting speech', () => {
    expect(feed(vad, 0.01, 0, 900)).toBe('calibrating');
  });

  it('reports speech once the level rises above the calibrated floor', () => {
    feed(vad, 0.01, 0, 1000);
    expect(feed(vad, 0.4, 1050, 1400)).toBe('speech');
  });

  it('ends the utterance after the configured silence window', () => {
    feed(vad, 0.01, 0, 1000);
    feed(vad, 0.4, 1050, 1400);
    expect(feed(vad, 0.01, 1450, 2300)).toBe('utterance-ended');
  });

  it('ignores a blip shorter than the minimum speech duration', () => {
    feed(vad, 0.01, 0, 1000);
    vad.push(0.4, 1050);
    expect(feed(vad, 0.01, 1100, 2000)).toBe('idle');
  });

  it('truncates an utterance that exceeds the maximum duration', () => {
    feed(vad, 0.01, 0, 1000);
    expect(feed(vad, 0.4, 1050, 32000, 500)).toBe('utterance-truncated');
  });

  it('does not trigger on a loud but steady ambient floor', () => {
    expect(feed(vad, 0.3, 0, 3000)).toBe('calibrating');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bunx vitest run tests/unit/renderer/voice/adaptiveVad.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AdaptiveVad`**

Track a calibration window that averages RMS until `calibrationMs` has elapsed, then set the threshold to `floor + (1 - sensitivity) * max(floor, 0.05) * k` where `k` is tuned so the tests above pass. Emit `speech-started` on the first frame above threshold, `speech` while above, `utterance-ended` when the level has stayed below threshold for `silenceMs` **and** accumulated speech reached `minimumSpeechMs`, `idle` when it stayed below and speech did not reach the minimum, and `utterance-truncated` when speech has run for `maximumUtteranceMs`. The last of the ambient window is retained so a later ambient shift re-baselines the floor.

- [ ] **Step 4: Run and confirm the tests pass**

Run: `bunx vitest run tests/unit/renderer/voice/adaptiveVad.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Implement `MicrophoneCapture`**

Use `navigator.mediaDevices.getUserMedia({ audio: { deviceId, channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true } })`, an `AudioContext({ sampleRate: 16000 })`, and an `AnalyserNode` or `ScriptProcessor`-free `AudioWorklet` to emit per-frame RMS plus the raw `Float32Array`. Buffer frames from `speech-started` until the utterance ends, then encode to PCM16 mono 16 kHz WAV and return it as the `VoicePcm16Wav` shape the bridge already validates: `{ encoding: 'base64', mimeType: 'audio/wav', sampleRateHz: 16000, channels: 1, sampleFormat: 'pcm16le', byteLength, dataBase64 }`. `stop()` must stop every track and close the context.

- [ ] **Step 6: Type check**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/services/voice tests/unit/renderer/voice
git commit -m "feat(voice): add microphone capture and voice activity detection"
```

---

## Task 5: Hands-free conversation control

**Files:**

- Create: `packages/desktop/src/renderer/hooks/voice/useFoolVoiceSession.ts`
- Modify: `packages/desktop/src/renderer/components/chat/VoiceTalkButton.tsx`
- Modify: `packages/desktop/src/renderer/components/chat/SendBox/index.tsx:1347-1354`
- Test: `tests/unit/renderer/voice/voiceTalkButton.dom.test.tsx`

**Interfaces:**

- Consumes: `AdaptiveVad`, `MicrophoneCapture` (Task 4); `AudioPlaybackService.play(audio)` / `.stop()`; `ipcBridge.foolVoice.transcribe` / `.synthesize` / `.health`; `isVoiceTurnTransitionAllowed` and `VoiceTurnState` from `@/common/types/foolVoice`.
- Produces:
  - `useFoolVoiceSession(): { state: VoiceTurnState; missingModelId: string | null; start(): Promise<void>; stop(): void }`
  - `type VoiceTalkButtonProps = { disabled?: boolean; onRequestModelInstall?: (modelId: string) => void }` — the callback opens the Voice settings install flow from Task 6.

The hook submits transcripts by dispatching the existing `fool:voice-submit` window event that `SendBox` listens for, so all ACP and Foolrs routing and permission behavior is untouched.

- [ ] **Step 1: Write the failing button tests**

```tsx
// tests/unit/renderer/voice/voiceTalkButton.dom.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VoiceTalkButton from '@renderer/components/chat/VoiceTalkButton';

const session = {
  state: { phase: 'idle', condition: { status: 'normal' }, enteredAtMs: 0 },
  missingModelId: null,
  start: vi.fn(),
  stop: vi.fn(),
};
vi.mock('@renderer/hooks/voice/useFoolVoiceSession', () => ({ useFoolVoiceSession: () => session }));

describe('VoiceTalkButton', () => {
  it('is rendered even when speech-to-text is not enabled in tools settings', () => {
    render(<VoiceTalkButton />);
    expect(screen.getByRole('button', { name: /talk/i })).toBeTruthy();
  });

  it('starts a session when idle', () => {
    render(<VoiceTalkButton />);
    fireEvent.click(screen.getByRole('button', { name: /talk/i }));
    expect(session.start).toHaveBeenCalled();
  });

  it('opens the install flow instead of starting when a model is missing', () => {
    session.missingModelId = 'tts-kokoro-en-v1';
    const onInstall = vi.fn();
    render(<VoiceTalkButton onRequestModelInstall={onInstall} />);
    fireEvent.click(screen.getByRole('button', { name: /talk/i }));
    expect(session.start).not.toHaveBeenCalled();
    expect(onInstall).toHaveBeenCalledWith('tts-kokoro-en-v1');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bunx vitest run tests/unit/renderer/voice/voiceTalkButton.dom.test.tsx`
Expected: FAIL — the current stub renders a `console.log` handler and has no install path.

- [ ] **Step 3: Implement `useFoolVoiceSession`**

Drive the loop `command-listening → transcribing → agent-running → narrating → speaking → command-listening`, guarding every transition with `isVoiceTurnTransitionAllowed` and refusing disallowed ones. On `AdaptiveVad` reporting `utterance-ended`, take the WAV from `MicrophoneCapture`, call `ipcBridge.foolVoice.transcribe`, and on a non-empty transcript dispatch `new CustomEvent('fool:voice-submit', { detail: { text } })`. When the turn completes, synthesize the reply and play it through `AudioPlaybackService`. While playing, keep the VAD running: `speech-started` calls `AudioPlaybackService.stop()` and moves straight to the next capture. Before starting, call `ipcBridge.foolVoice.health` for the configured STT and TTS models; a `model-not-installed` reason sets `missingModelId` and the session does not start.

- [ ] **Step 4: Rewrite `VoiceTalkButton.tsx`**

Replace the `console.log` handler with the hook, and declare the props as `VoiceTalkButtonProps` above (`disabled` plus the new `onRequestModelInstall`). Render an Arco `Button` with an aria-label from an i18n key, reflecting phase in the icon and tooltip. When `missingModelId` is set, click calls `onRequestModelInstall(missingModelId)` instead of `start()`. Remove the `TODO` comment. The component renders unconditionally — no `tools.speechToText.enabled` check.

- [ ] **Step 5: Confirm `SendBox` renders it unconditionally and handles the submit event**

In `SendBox/index.tsx`, keep `VoiceTalkButton` in the fragment added alongside `SpeechInputButton`, but render it outside the `isMobileCompact ? null :` guard's speech gating so it is present whenever the composer is. Add a `useEffect` listening for `fool:voice-submit` that fills the composer and submits through the existing send path.

- [ ] **Step 6: Run the tests and type check**

Run: `bunx vitest run tests/unit/renderer/voice/ && bunx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 7: Manual check**

Launch the app. Confirm the control is visible on the welcome screen and in an open conversation. With no speech models installed, clicking it opens the install flow and names the missing model. With models installed, speak a short English request and confirm it is transcribed, answered, and spoken back, and that speaking during playback stops the audio.

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src/renderer tests/unit/renderer
git commit -m "feat(voice): add hands-free conversation control"
```

---

## Task 6: Voice settings category

**Files:**

- Create: `packages/desktop/src/renderer/components/settings/SettingsModal/contents/voice/VoiceSettingsContent.tsx`
- Create: `packages/desktop/src/renderer/components/settings/SettingsModal/contents/voice/DeviceSection.tsx`
- Create: `packages/desktop/src/renderer/components/settings/SettingsModal/contents/voice/ModelSection.tsx`
- Modify: `packages/desktop/src/renderer/components/settings/SettingsModal/index.tsx:304`
- Modify: `packages/desktop/src/renderer/components/settings/SettingsModal/useSettingsModal.tsx`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/settings.json`
- Test: `tests/unit/renderer/voice/voiceSettingsContent.dom.test.tsx`

**Interfaces:**

- Consumes: `ipcBridge.foolVoice.catalog` / `.download` / `.remove` / `.health` / `.synthesize`; `FoolVoiceSettings`.
- Produces: settings sidebar key `'voice'`.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/unit/renderer/voice/voiceSettingsContent.dom.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import VoiceSettingsContent from '@renderer/components/settings/SettingsModal/contents/voice/VoiceSettingsContent';

describe('VoiceSettingsContent', () => {
  it('renders every section', async () => {
    render(<VoiceSettingsContent />);
    for (const key of ['devices', 'conversation', 'speechToText', 'textToSpeech']) {
      expect(await screen.findByTestId(`voice-section-${key}`)).toBeTruthy();
    }
  });

  it('shows an install action rather than a ready state when a model is not installed', async () => {
    render(<VoiceSettingsContent />);
    expect(await screen.findByTestId('voice-model-install-tts-kokoro-en-v1')).toBeTruthy();
  });

  it('does not render the cloning section while cloning is unsupported', () => {
    render(<VoiceSettingsContent />);
    expect(screen.queryByTestId('voice-section-cloning')).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bunx vitest run tests/unit/renderer/voice/voiceSettingsContent.dom.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the sections**

`DeviceSection` lists microphones and speakers from `navigator.mediaDevices.enumerateDevices()` in Arco `Select`s with a live input meter and a test control. `ModelSection` renders the catalog from `ipcBridge.foolVoice.catalog`, each model showing its state, an install or remove action with measured progress, its health, and a `local` or `network` privacy label. `VoiceSettingsContent` composes the four sections plus the conversation controls (wake phrase, silence timeout, barge-in) bound to `FoolVoiceSettings`. Each section root carries `data-testid="voice-section-<key>"`.

- [ ] **Step 4: Register the sidebar category**

Add a `'voice'` entry to the settings sidebar in `useSettingsModal.tsx` with an `@icon-park/react` icon, and a `case 'voice': return <VoiceSettingsContent />;` branch in `index.tsx` next to line 304.

- [ ] **Step 5: Move the existing voice controls and prove nothing was lost**

List every control currently rendered by `SystemModalContent/VoiceInputSection` (including `SpeechTestPanel`). Move each into the new category. Then confirm each one is reachable in the new location and record the mapping in the commit message. A control with no new home is a defect — do not drop it.

- [ ] **Step 6: Add i18n keys**

Add every new string to all locale directories with reviewed English and Turkish copy.

Run: `bun run i18n:types && node scripts/check-i18n.js`
Expected: both succeed with no missing keys.

- [ ] **Step 7: Run the tests, lint, format, and type check**

Run: `bunx vitest run tests/unit/renderer/ && bun run lint:fix && bun run format && bunx tsc --noEmit`
Expected: tests pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src/renderer tests/unit/renderer
git commit -m "feat(voice): add dedicated voice settings category"
```

---

## Task 7: Voice cloning — measure first, ship only if it works

**Files:**

- Create: `docs/research/the-fool-voice-cloning-spike.md`
- Modify only if every gate passes: `VoiceModelCatalog.ts`, `SherpaVoiceProvider.ts`, `VoiceSettingsContent.tsx`, `initBridge.ts`
- Test only if shipped: `tests/unit/renderer/voice/voiceCloningSection.dom.test.tsx`

**Interfaces:**

- Consumes: the existing `VoiceProfile` union, which already has a `kind: 'cloned'` variant with `state: 'creating' | 'ready' | 'failed'` and `deletable: true`, and the existing `'voice-cloning'` member of `VoiceCapability`. No type changes are needed to represent a cloned profile.
- Produces: if shipped, `local-sherpa` advertises `'voice-cloning'` and the settings category renders `data-testid="voice-section-cloning"`.

**Time-box: stop and write the decision after 60 minutes of spike work.** This task is last precisely so a negative result costs nothing else in the plan.

- [ ] **Step 1: Locate the ZipVoice release asset**

Find the ZipVoice model on the `k2-fsa/sherpa-onnx` releases and record the URL, size, `sha256`, file manifest, and license of both the model weights and the training data terms.

- [ ] **Step 2: Prove synthesis works from Node on this machine**

Write a throwaway script under the scratchpad (not in the repo) that loads the ZipVoice model through `sherpa-onnx-node`'s `OfflineTts` with `model.zipvoice`, passes a reference WAV and its transcript, and writes an output WAV. Measure cold and warm latency for a 20-word English sentence.

- [ ] **Step 3: Record the decision**

Write `docs/research/the-fool-voice-cloning-spike.md` with the source URLs, licenses, measured cold and warm latency, output quality assessment, failure modes, and an explicit PASS or FAIL per gate: Windows x64 operation, English intelligibility, usable latency, redistributable license, verified deletion of reference samples.

- [ ] **Step 4a: If any gate FAILED — record and stop**

Leave the cloning section unrendered. State the failing gate in the document. Do not add a disabled control, a "coming soon" label, or any other placeholder.

```bash
git add docs/research
git commit -m "docs(voice): record voice cloning capability decision"
```

- [ ] **Step 4b: If every gate PASSED — ship it**

Add the ZipVoice catalog entry with its pinned `sha256`. Add `'voice-cloning'` to the `local-sherpa` provider capabilities. Extend `SherpaVoiceProvider` with `createVoiceProfile(referenceWav, referenceText, displayName)` and `deleteVoiceProfile(id)`, storing reference audio under `<userData>/fool/voice-profiles/<id>/` and deleting that directory on profile deletion. Render the cloning section only when the provider advertises the capability, gated on an explicit Arco `Checkbox` authorization statement, with record, preview, rename, and delete. State in the UI that cloning quality is good in English and poor in Turkish. Add tests covering: section hidden without the capability, creation blocked until authorization is checked, and deletion removing the stored reference audio.

```bash
git add packages/desktop/src docs/research tests/unit/renderer
git commit -m "feat(voice): add authorized local voice profiles"
```

---

## Final Verification

- [ ] Run `bun run test`, `bunx tsc --noEmit`, `bun run lint:fix`, `bun run format:check`, `bun run i18n:types`, `node scripts/check-i18n.js`.
- [ ] Run `bun run package` and confirm it still succeeds. Do **not** run `build-win:x64` — installer production is deferred.
- [ ] Confirm the LM Studio picker lists every installed model, and that stopping LM Studio leaves the previously known list intact rather than clearing it.
- [ ] Confirm every control that lived in `SystemModalContent/VoiceInputSection` is reachable in the new Voice category.
- [ ] Search the diff for `TODO`, `FIXME`, `placeholder`, `coming soon`, and `console.log` and remove any that reached product code.
- [ ] Report honestly which of the 13 spec acceptance items pass, and name any that do not.
