/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(__dirname, '../..');
const read = (path: string): string => readFileSync(resolve(projectRoot, path), 'utf8');

describe('Apache-2.0 obligations for a derivative work', () => {
  it('names the upstream projects this work derives from', () => {
    const notice = read('NOTICE');

    // 4(c): attribution notices from the original work must be retained, and
    // they have to name what they attribute.
    expect(notice).toContain('AionUi');
    expect(notice).toContain('Copyright 2025 AionUi (aionui.com)');
    expect(notice).toContain('Apache License, Version 2.0');
  });

  it('states that the files were modified', () => {
    const notice = read('NOTICE');

    // 4(b) is the clause a fork most often misses: carrying the upstream
    // copyright is not enough, the modification itself must be declared.
    expect(notice).toMatch(/MODIFICATIONS/i);
    expect(notice).toMatch(/have been\s+modified/i);
  });

  it('claims our own copyright without erasing upstream', () => {
    const license = read('LICENSE');

    expect(license).toContain('Copyright 2026 The Fool contributors');
    expect(license).toContain('Copyright 2025 AionUi (aionui.com)');
  });

  it('ships the License and the notices with the installed app', () => {
    const builder = read('packages/desktop/electron-builder.yml');

    // 4(a) and 4(d) are obligations to *recipients of the binary*. Leaving
    // these files in the repository only satisfies them for people who clone.
    expect(builder).toMatch(/from:\s*LICENSE/);
    expect(builder).toMatch(/from:\s*NOTICE/);
  });

  it('declares the same license the upstream work was released under', () => {
    const pkg = JSON.parse(read('package.json')) as { license: string };

    expect(pkg.license).toBe('Apache-2.0');
  });
});
