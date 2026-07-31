/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LocalModelEntry } from './lmsCli';

export type ScanFs = {
  readdir: (path: string) => Promise<{ name: string; isDirectory: boolean }[]>;
};

/** LM Studio stores models as `<publisher>/<repo>/<file>.gguf`. */
const MAX_DEPTH = 3;
const MAX_FILES = 2000;
const GGUF_SUFFIX = '.gguf';

/** Multimodal projector sidecars are not standalone selectable models. */
const PROJECTOR_PREFIX = 'mmproj-';

/**
 * Fallback discovery for when the `lms` CLI is unavailable.
 *
 * Returns `null` when the tree cannot be read at all, so the caller can fall
 * through to the HTTP tier rather than treating an unreadable directory as
 * "no models installed". An empty but readable tree returns `[]`.
 */
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
      if (!entry.name.endsWith(GGUF_SUFFIX) || entry.name.startsWith(PROJECTOR_PREFIX)) continue;

      found.push({
        id: nextRelative,
        displayName: entry.name.slice(0, -GGUF_SUFFIX.length),
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
