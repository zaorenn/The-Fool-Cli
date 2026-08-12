/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The workspace boundary on the image tool.
 *
 * Every path this tool resolves arrives in a tool call the model wrote. Without
 * a boundary, `../../../etc/passwd` — or any absolute path — was read and handed
 * straight back to the model base64-encoded, which turns an image tool into an
 * arbitrary-file-read tool.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isWithin, processImageUri, resolveWithinWorkspace } from '@/common/chat/imageGenCore';

describe('isWithin', () => {
  it('accepts a file directly inside the root', () => {
    expect(isWithin('/work', '/work/a.png')).toBe(true);
  });

  it('accepts a file nested deeper inside the root', () => {
    expect(isWithin('/work', '/work/images/a.png')).toBe(true);
  });

  it('accepts the root itself', () => {
    expect(isWithin('/work', '/work')).toBe(true);
  });

  it('rejects a parent directory', () => {
    expect(isWithin('/work', '/work/../secrets.txt')).toBe(false);
  });

  it('rejects a sibling that merely shares a prefix', () => {
    expect(isWithin('/work', '/work-other/a.png')).toBe(false);
  });
});

describe('resolveWithinWorkspace', () => {
  const workspace = resolve('/work');

  it('resolves a relative path against the workspace', () => {
    expect(resolveWithinWorkspace(workspace, 'a.png')).toBe(join(workspace, 'a.png'));
  });

  it('refuses a traversal out of the workspace', () => {
    expect(() => resolveWithinWorkspace(workspace, '../../../etc/passwd')).toThrow(/outside the workspace/);
  });

  it('refuses an absolute path outside the workspace', () => {
    expect(() => resolveWithinWorkspace(workspace, resolve('/etc/passwd'))).toThrow(/outside the workspace/);
  });

  it('allows an absolute path that is already inside the workspace', () => {
    const inside = join(workspace, 'nested', 'a.png');

    expect(resolveWithinWorkspace(workspace, inside)).toBe(inside);
  });
});

describe('processImageUri', () => {
  let workspace: string;
  let outsideFile: string;

  beforeAll(() => {
    const base = mkdtempSync(join(tmpdir(), 'fool-imagegen-'));
    workspace = join(base, 'workspace');
    mkdirSync(workspace);
    // A readable PNG that the tool must still refuse, because of where it is.
    outsideFile = join(base, 'secret.png');
    writeFileSync(outsideFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(workspace, 'inside.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  afterAll(() => {
    rmSync(resolve(workspace, '..'), { recursive: true, force: true });
  });

  it('reads an image that is inside the workspace', async () => {
    const content = await processImageUri('inside.png', workspace);

    expect(content?.image_url.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('refuses a traversal even when the file exists and is a real image', async () => {
    await expect(processImageUri('../secret.png', workspace)).rejects.toThrow(/outside the workspace/);
  });

  it('refuses an absolute path outside the workspace', async () => {
    await expect(processImageUri(outsideFile, workspace)).rejects.toThrow(/outside the workspace/);
  });

  it('refuses a traversal written with the @ prefix the tool strips', async () => {
    await expect(processImageUri('@../secret.png', workspace)).rejects.toThrow(/outside the workspace/);
  });

  it('passes an http url through without touching the filesystem', async () => {
    const content = await processImageUri('https://example.com/a.png', workspace);

    expect(content?.image_url.url).toBe('https://example.com/a.png');
  });

  it('still reports a missing file inside the workspace as missing', async () => {
    await expect(processImageUri('nope.png', workspace)).rejects.toThrow(/not found/i);
  });
});
