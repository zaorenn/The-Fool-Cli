/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(__dirname, '../..');
const read = (path: string): string => readFileSync(resolve(projectRoot, path), 'utf8');

/**
 * The DLLs a fresh Windows does not have.
 *
 * `api-ms-win-crt-*` is deliberately absent: the universal CRT ships with
 * Windows 10 and later, so importing it is fine. These two arrive only with the
 * Visual C++ redistributable, which a newly installed machine has no reason to
 * carry.
 */
const REDISTRIBUTABLE_DLL = /(VCRUNTIME140[_0-9]*|MSVCP140[_0-9]*)\.dll/i;

/** Every `.node` a directory holds, however deeply prebuilds nest them. */
const nativeModulesIn = (directory: string): string[] => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.node'))
    .map((entry) => resolve(entry.parentPath, entry.name));
};

/**
 * The promise is that one downloaded installer works on a Windows that has
 * nothing else on it. The failure mode these guard is silent: the app installs,
 * the window opens, and the backend never starts because a runtime DLL that
 * every developer machine happens to have is missing on a fresh one.
 */
describe('clean Windows install', () => {
  it('links the MSVC runtime into the backend instead of depending on the redistributable', () => {
    const buildScript = read('scripts/buildFoolcore.js');

    expect(buildScript).toContain('+crt-static');
    expect(buildScript).toMatch(/win32/);
  });

  it('keeps the static CRT out of the cargo config, where it would break the tests', () => {
    // Setting it there applies it to `cargo test` too, and the test harness
    // cannot link proc-macro and dylib crates against a static CRT.
    const cargoConfig = read('backend/core/.cargo/config.toml');
    const uncommented = cargoConfig
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');

    expect(uncommented).not.toContain('crt-static');
  });

  it('keeps no dynamic Visual C++ runtime import in the staged backend', () => {
    const staged = resolve(projectRoot, 'resources/bundled-foolcore/win32-x64/foolcore.exe');
    if (!existsSync(staged)) {
      // Nothing to check until `scripts/buildFoolcore.js` has run.
      return;
    }

    const imports = readFileSync(staged).toString('latin1');

    expect(imports).not.toMatch(/VCRUNTIME140[_0-9]*\.dll/i);
    expect(imports).not.toMatch(/MSVCP140[_0-9]*\.dll/i);
  });

  it('keeps the same dependency out of the native modules the app itself loads', () => {
    // The backend is not the only thing that has to start. These are loaded by
    // the main process, and one of them importing the redistributable fails the
    // same way and just as quietly: the window opens onto a broken app.
    const packaged = ['better-sqlite3', 'bcrypt', 'node-pty', 'sherpa-onnx-node', 'sherpa-onnx-win-x64'];
    const modules = packaged.flatMap((name) => nativeModulesIn(resolve(projectRoot, 'node_modules', name)));

    // A rename or a dependency drop that empties this would make the assertion
    // below pass against nothing.
    expect(modules.length).toBeGreaterThan(0);

    const dependent = modules.filter((file) => REDISTRIBUTABLE_DLL.test(readFileSync(file).toString('latin1')));
    expect(dependent.map((file) => file.replace(projectRoot, ''))).toEqual([]);
  });

  it('ships the backend and the speech runtime inside the package', () => {
    const builder = read('packages/desktop/electron-builder.yml');

    // Downloading either of these after install would defeat the whole point.
    expect(builder).toContain('resources/bundled-foolcore');
    expect(builder).toMatch(/node_modules\/sherpa-onnx-node/);
  });

  it('stages the runtime and the manifest, which cargo cannot produce', () => {
    // The backend release zip carried a Node runtime, the agent CLIs and a
    // bundle manifest alongside the binary. Building the backend from source
    // removed the download, not the app's need for them, and `afterPack.js`
    // refuses to package without all three.
    const buildScript = read('scripts/buildFoolcore.js');

    expect(buildScript).toContain('managed-resources');
    expect(buildScript).toContain('manifest.json');
  });

  it('leaves nothing the packer verifies missing from the staged bundle', () => {
    const stageDir = resolve(projectRoot, 'resources/bundled-foolcore/win32-x64');
    if (!existsSync(resolve(stageDir, 'foolcore.exe'))) {
      // Nothing to check until `scripts/buildFoolcore.js` has run.
      return;
    }

    expect(existsSync(resolve(stageDir, 'manifest.json'))).toBe(true);
    expect(existsSync(resolve(stageDir, 'managed-resources', 'manifest.json'))).toBe(true);
  });
});
