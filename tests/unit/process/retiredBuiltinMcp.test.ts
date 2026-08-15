/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A builtin taken out of the defaults has to leave the machines it reached.
 *
 * The bootstrap only adds — `missing` is the defaults not yet in the database,
 * and nothing walks the other way — so deleting an entry from the source spares
 * new installations and leaves every existing one running it. That is the shape
 * of "removed" that a user reports as "it is still there".
 *
 * `uacc-computer-control` drove the screen through a Python sidecar at an
 * absolute path on one developer's machine. The user asked for the capability to
 * go, not to be disabled.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = resolve(__dirname, '../../../packages/desktop/src/process/utils/runBackendMigrations.ts');
const source = readFileSync(MIGRATIONS, 'utf8');

describe('uacc is gone', () => {
  it('is not registered as a builtin any more', () => {
    // Configured, not merely mentioned: the comment above the removal list says
    // what this was and why it went, and that history is worth keeping. What
    // must not come back is a transport pointing at the sidecar, or an entry
    // handing the name to the server list.
    expect(source).not.toMatch(/args:\s*\[[^\]]*uacc-sidecar/s);
    expect(source).not.toMatch(/command:\s*'[^']*uacc-sidecar[^']*'/);
    expect(source).not.toMatch(/name:\s*'uacc-computer-control'/);
  });

  it('is listed for removal from installations that already have it', () => {
    // Accepts a bare array or a Set of one. The container is not the point —
    // the name being in the list is — and pinning the literal shape made this
    // fail the day the linter's own autofix rewrote `.includes` into `.has`,
    // which is a test failing for something nobody reading it would call a bug.
    expect(source).toMatch(/RETIRED_BUILTIN_MCP_SERVERS[^=]*=[^;]*'uacc-computer-control'/s);
  });

  it('the removal actually runs during the bootstrap', () => {
    // Guards against the list existing and being consulted by nothing, which is
    // this repository's most repeated defect.
    expect(source).toContain('await removeRetiredBuiltinServers(');
    expect(source).toContain('mcpService.deleteServer.invoke(');
  });

  it('ships no absolute path from somebody’s own machine as a builtin', () => {
    // What made this one indefensible quite apart from the capability: a
    // `c:\Fool-AionUI\...` command in a list every installation receives.
    const builtins = source.slice(source.indexOf('function buildDefaultMcpServers'));
    expect(builtins).not.toMatch(/command:\s*'[a-zA-Z]:\\\\/);
  });
});
