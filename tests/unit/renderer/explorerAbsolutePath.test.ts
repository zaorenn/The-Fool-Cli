/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Naming a tree node on the machine it actually lives on.
 *
 * The explorer speaks in `pe_id` + relative path, which is the right currency
 * inside the app and useless to "show me this in Explorer". Joining the two is
 * where a path gets quietly mangled: the wrong separator, a doubled slash, a
 * root whose own path is unknown. A reveal that opens the wrong folder is worse
 * than one that is not offered, so the unknown case answers null rather than
 * guessing.
 */

import { describe, expect, it } from 'vitest';
import { absolutePathOf, type RootRef } from '@renderer/pages/conversation/explorer/explorerModel';
import { entryToRootRef } from '@renderer/pages/conversation/explorer/projectRoots';
import type { ProjectEntryDto } from '@/common/types/project';

const windowsRoot: RootRef = { pe_id: 'pe-win', title: 'app', path: 'C:\\work\\app' };
const posixRoot: RootRef = { pe_id: 'pe-nix', title: 'app', path: '/home/me/app' };
const roots = [windowsRoot, posixRoot];

describe('absolutePathOf', () => {
  it('joins a posix root with the separator that root is written in', () => {
    expect(absolutePathOf(roots, 'pe-nix', 'src/index.ts')).toBe('/home/me/app/src/index.ts');
  });

  it('joins a windows root with backslashes, whatever platform is asking', () => {
    expect(absolutePathOf(roots, 'pe-win', 'src/index.ts')).toBe('C:\\work\\app\\src\\index.ts');
  });

  it('returns the root itself for the root node', () => {
    expect(absolutePathOf(roots, 'pe-nix', '')).toBe('/home/me/app');
  });

  it('does not double the separator when the root ends in one', () => {
    expect(absolutePathOf([{ pe_id: 'p', title: 'a', path: '/home/me/app/' }], 'p', 'src')).toBe('/home/me/app/src');
  });

  it('does not double the separator when the relative path starts with one', () => {
    expect(absolutePathOf(roots, 'pe-nix', '/src')).toBe('/home/me/app/src');
  });

  it('answers null for a root whose path the backend could not render', () => {
    expect(absolutePathOf([{ pe_id: 'p', title: 'a' }], 'p', 'src')).toBeNull();
  });

  it('answers null for a pe_id that is not in the project', () => {
    expect(absolutePathOf(roots, 'pe-gone', 'src')).toBeNull();
  });

  it('handles a nested path without leaving a stray separator', () => {
    expect(absolutePathOf(roots, 'pe-win', 'a/b/c.txt')).toBe('C:\\work\\app\\a\\b\\c.txt');
  });
});

describe('entryToRootRef', () => {
  const entry = (overrides: Partial<ProjectEntryDto> = {}): ProjectEntryDto =>
    ({
      pe_id: 'pe-1',
      role: 'workspace',
      display_path: '/home/me/app',
      order_index: 0,
      runtime_status: 'available',
      ...overrides,
    }) as ProjectEntryDto;

  it('carries the folder path through, so the tree can name it on disk', () => {
    expect(entryToRootRef(entry()).path).toBe('/home/me/app');
  });

  it('leaves the path absent rather than empty when the backend has none', () => {
    expect(entryToRootRef(entry({ display_path: '' })).path).toBeUndefined();
  });

  it('still titles the root from its display name', () => {
    expect(entryToRootRef(entry({ display_name: 'My app' })).title).toBe('My app');
  });
});
