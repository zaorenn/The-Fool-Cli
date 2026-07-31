/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `.gitignore` used to carry a bare `kanban/` pattern for a contributor's
 * personal local task-tracking folder. Unscoped, it matched a directory named
 * `kanban` at any depth — which silently excluded the real product Kanban
 * feature (`packages/desktop/src/renderer/pages/conversation/kanban/` and its
 * test directory) from every commit, with no warning: `git status` simply
 * never listed the files. The fix scopes the original rule to the repo root
 * (`/kanban/`); this guards against it (or an equally broad rule) coming back.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');

const isIgnored = (relativePath: string): boolean => {
  try {
    execFileSync('git', ['check-ignore', '--quiet', relativePath], { cwd: repoRoot });
    return true;
  } catch (error) {
    // `git check-ignore` exits 1 when the path is not ignored.
    if ((error as { status?: number }).status === 1) return false;
    throw error;
  }
};

describe('the Kanban feature directories are tracked by git', () => {
  it.each([
    'packages/desktop/src/renderer/pages/conversation/kanban/KanbanBoard.tsx',
    'tests/unit/renderer/kanban/KanbanBoard.dom.test.tsx',
  ])('%s is not git-ignored', (relativePath) => {
    expect(isIgnored(relativePath)).toBe(false);
  });
});
