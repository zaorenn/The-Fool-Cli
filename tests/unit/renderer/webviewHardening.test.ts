/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(__dirname, '../../..');

function readProjectFile(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8');
}

/**
 * `allowpopups` is a boolean attribute: Electron reads it with `hasAttribute`,
 * so `allowpopups="false"` is present and therefore *enabled* — the exact
 * opposite of what the string says. The in-app browser visits arbitrary sites,
 * and a page that can call `window.open` gets a window this app never
 * configured. The only way to disable it is to not write the attribute.
 */
describe('webview hardening', () => {
  const source = readProjectFile('packages/desktop/src/renderer/components/media/WebviewHost.tsx');

  it('never writes allowpopups as a string', () => {
    expect(source).not.toMatch(/allowpopups\s*:\s*['"]/);
    expect(source).not.toMatch(/allowpopups\s*=\s*['"]/);
  });

  it('keeps node integration off for guest pages', () => {
    expect(source).toContain('nodeIntegration=no');
  });
});
