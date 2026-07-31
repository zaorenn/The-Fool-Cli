/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { clearParsedDiffCache, parseDiff } from '@renderer/utils/file/diffUtils';

const diff = ['diff --git a/src/app.ts b/src/app.ts', '@@ -1,3 +1,4 @@', ' kept', '-gone', '+added', '+also'].join(
  '\n'
);

describe('parseDiff caching', () => {
  beforeEach(() => clearParsedDiffCache());

  it('parses a diff correctly', () => {
    expect(parseDiff(diff)).toMatchObject({
      file_name: 'app.ts',
      fullPath: 'src/app.ts',
      insertions: 2,
      deletions: 1,
    });
  });

  it('returns the very same result for the same diff', () => {
    // The message list re-parses the whole conversation on every streamed chunk;
    // returning the cached object is what stops that being most of a frame.
    expect(parseDiff(diff)).toBe(parseDiff(diff));
  });

  it('keeps two files with the same content apart', () => {
    const body = '@@ -1 +1 @@\n-a\n+b';

    expect(parseDiff(body, 'one.ts').file_name).toBe('one.ts');
    expect(parseDiff(body, 'two.ts').file_name).toBe('two.ts');
  });

  it('re-parses a diff that has grown, which is what a streaming write does', () => {
    const first = parseDiff('@@ -1 +1 @@\n+one', 'app.ts');
    const second = parseDiff('@@ -1 +1 @@\n+one\n+two', 'app.ts');

    expect(first.insertions).toBe(1);
    expect(second.insertions).toBe(2);
  });

  it('forgets the oldest entries rather than growing without limit', () => {
    for (let index = 0; index < 600; index += 1) {
      parseDiff(`@@ -1 +1 @@\n+line ${index}`, `file-${index}.ts`);
    }

    // The first one is gone, so a fresh object comes back for it.
    const again = parseDiff('@@ -1 +1 @@\n+line 0', 'file-0.ts');
    expect(again.insertions).toBe(1);
    expect(parseDiff('@@ -1 +1 @@\n+line 599', 'file-599.ts').insertions).toBe(1);
  });
});
