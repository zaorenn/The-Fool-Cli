/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A model installed locally by a local inference host (LM Studio today).
 *
 * `id` is the identifier the host accepts in a completion request's `model`
 * field, so it can be published straight into `IProvider.models`.
 */
export type LocalModelEntry = {
  id: string;
  displayName: string;
  contextLength: number | null;
  toolUse: boolean;
};

export type ExecFileFn = (file: string, args: string[], options: { timeout: number }) => Promise<{ stdout: string }>;

const CLI_TIMEOUT_MS = 5000;

/** LM Studio reports embeddings alongside chat models; only these are usable here. */
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

/**
 * Lists every model installed in LM Studio, loaded or not.
 *
 * Returns `null` when this tier cannot answer — the caller then falls back to
 * scanning the model directory. `lms ls --json` is a CLI output format rather
 * than a documented contract, so parsing is deliberately defensive: an
 * unrecognized entry is skipped, and unusable output degrades to `null` instead
 * of yielding an empty list that would look like "no models installed".
 */
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
      parsed = JSON.parse(stdout) as unknown;
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) return null;

    return parsed.map(toEntry).filter((entry): entry is LocalModelEntry => entry !== null);
  }

  return null;
};
