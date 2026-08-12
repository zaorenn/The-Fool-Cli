/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The backend's identity, and the build that produces it.
 *
 * The backend is compiled from source in this repository rather than downloaded
 * from another one, which is deliberate. What it had cost was identity: CI
 * carried a comment saying the version was "pinned in repo-root package.json
 * (foolcoreVersion)" and that key did not exist, so every binary this repository
 * has ever produced reported the same string with nothing to separate them. A
 * bug report naming a version named several months of builds.
 *
 * These assertions are about the three things that were wrong, all of which are
 * invisible until a release goes out: no declared version, no cargo cache on a
 * 27-crate workspace, and a workflow input wired to a script that never read it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(__dirname, '../..');
const read = (relative: string): string => readFileSync(resolve(projectRoot, relative), 'utf8');

const declaredVersion = (): string | undefined =>
  (JSON.parse(read('package.json')) as { foolcoreVersion?: string }).foolcoreVersion;

/** The version the Rust workspace calls itself, as `vX.Y.Z`. */
const workspaceVersion = (): string | undefined => {
  const found = read('backend/core/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m);
  return found ? `v${found[1]}` : undefined;
};

/** Workflows that compile the backend, and therefore want the cache. */
const BACKEND_BUILDING_WORKFLOWS = ['.github/workflows/_build-reusable.yml', '.github/workflows/pack-web-cli.yml'];

describe('the declared backend version', () => {
  it('exists, which is what CI had been claiming for months', () => {
    expect(declaredVersion()).toBeDefined();
  });

  it('is written the way a tag is', () => {
    expect(declaredVersion()).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it('agrees with the workspace it is meant to describe', () => {
    expect(declaredVersion()).toBe(workspaceVersion());
  });

  it('is what the build script asserts against, rather than something only read here', () => {
    const script = read('scripts/buildFoolcore.js');

    expect(script).toContain('foolcoreVersion');
    expect(script).toMatch(/declaredBackendVersion !== workspaceVersion/);
  });

  it('is stamped into the bundle manifest along with the commit that produced it', () => {
    const script = read('scripts/buildFoolcore.js');

    expect(script).toMatch(/version:\s*workspaceVersion/);
    expect(script).toMatch(/commit:\s*backendCommit/);
  });
});

describe('the workflows that compile the backend', () => {
  it.each(BACKEND_BUILDING_WORKFLOWS)('%s caches cargo and the target directory', (workflow) => {
    const yaml = read(workflow);

    expect(yaml).toContain('~/.cargo/registry/index');
    expect(yaml).toContain('backend/core/target');
  });

  it.each(BACKEND_BUILDING_WORKFLOWS)('%s keys that cache on the lockfile, not on nothing', (workflow) => {
    expect(read(workflow)).toContain("hashFiles('backend/core/Cargo.lock')");
  });

  it('still runs the source builder rather than reintroducing a download', () => {
    expect(read('.github/workflows/_build-reusable.yml')).toContain('node scripts/buildFoolcore.js');
  });
});

describe('dead wiring', () => {
  it('passes no run id to a script that never read one', () => {
    const workflows = [
      '.github/workflows/_build-reusable.yml',
      '.github/workflows/build-manual.yml',
      '.github/workflows/pack-web-cli.yml',
    ];

    for (const workflow of workflows) {
      // The explanatory comment in _build-reusable.yml names it; an actual
      // assignment or input declaration does not.
      expect(read(workflow)).not.toMatch(/^\s*(FOOL_BACKEND_RUN_ID:|foolcore_run_id:)/m);
    }
  });

  it('does not hand a token to a script that authenticates with nothing', () => {
    expect(read('scripts/pack-web-cli.js')).not.toContain('GH_TOKEN');
    expect(read('.github/workflows/pack-web-cli.yml')).not.toContain('GH_TOKEN');
  });
});
