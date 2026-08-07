/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_ID,
  defaultWorkspace,
  exportWorkspace,
  findWorkspaceByName,
  importWorkspace,
  listWorkspaces,
  MAX_WORKSPACES,
  normalizeWorkspaceName,
  resolveWorkspace,
  sanitizeWorkspace,
  sanitizeWorkspaces,
  workspaceFileName,
  WORKSPACE_FILE_KIND,
  type Workspace,
} from '@/common/config/workspaces';

/**
 * A workspace is the whole app aimed at one purpose.
 *
 * Two things make this different from every other setting, and both are
 * assertions here. It arrives from outside — a file somebody was sent — so what
 * it cannot be allowed to do matters more than what it can. And the one that
 * ships is the app's own, so nothing arriving from anywhere may overwrite it or
 * leave the user with nothing to fall back to.
 */

const made = (patch: Partial<Workspace> = {}): Workspace => ({
  ...defaultWorkspace(),
  id: 'guitar',
  name: 'Guitar',
  description: 'Turns a link into tab',
  builtin: false,
  ...patch,
});

describe('sanitizeWorkspace', () => {
  it('reads back what was written', () => {
    const workspace = sanitizeWorkspace(
      made({ voice: { personaPresetId: 'companion', instructions: 'Be brief.', language: 'tr' } })
    );

    expect(workspace?.name).toBe('Guitar');
    expect(workspace?.voice.instructions).toBe('Be brief.');
    expect(workspace?.voice.language).toBe('tr');
  });

  it('refuses anything that is not a record, rather than inventing one', () => {
    for (const junk of [null, 'guitar', 7, []]) expect(sanitizeWorkspace(junk)).toBeNull();
    expect(sanitizeWorkspace({ name: '   ' })).toBeNull();
  });

  /**
   * A file claiming to be the shipped workspace would be one nobody can delete
   * — so the flag is decided by the id here rather than read from the data.
   */
  it('never takes “built in” from the data it was handed', () => {
    expect(sanitizeWorkspace({ ...made(), builtin: true })?.builtin).toBe(false);
  });

  it('carries no keys, which is what makes one safe to send to somebody', () => {
    const workspace = sanitizeWorkspace({
      ...made(),
      agent: { assistantId: 'a', providerId: 'p', modelId: 'm', apiKey: 'sk-secret' },
    });

    expect(JSON.stringify(workspace)).not.toContain('sk-secret');
    expect(workspace?.agent).toEqual({ assistantId: 'a', providerId: 'p', modelId: 'm' });
  });
});

describe('sanitizeWorkspaces', () => {
  it('always offers the shipped one, whatever was stored', () => {
    expect(sanitizeWorkspaces(null)[DEFAULT_WORKSPACE_ID]).toBeTruthy();
    expect(sanitizeWorkspaces({ guitar: made() })[DEFAULT_WORKSPACE_ID]).toBeTruthy();
  });

  /**
   * Rebuilt from code rather than read back, so a stored copy cannot drift from
   * what the app actually does by default.
   */
  it('rebuilds the shipped one rather than trusting a stored copy of it', () => {
    const library = sanitizeWorkspaces({ default: made({ id: 'default', name: 'Hijacked' }) });

    expect(library[DEFAULT_WORKSPACE_ID].name).toBe('Default');
    expect(library[DEFAULT_WORKSPACE_ID].builtin).toBe(true);
  });

  it('drops an entry it cannot read, and keeps the ones it can', () => {
    const library = sanitizeWorkspaces({ broken: 'not a workspace', guitar: made() });

    expect(Object.keys(library).toSorted()).toEqual(['default', 'guitar']);
  });

  it('keeps a bounded number of them', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_WORKSPACES + 6 }, (_unused, index) => [
        `w${index}`,
        made({ id: `w${index}`, name: `W${index}` }),
      ])
    );

    expect(Object.keys(sanitizeWorkspaces(many)).length).toBeLessThanOrEqual(MAX_WORKSPACES);
  });
});

describe('resolveWorkspace', () => {
  const library = sanitizeWorkspaces({ guitar: made() });

  it('gives back the one in force', () => {
    expect(resolveWorkspace(library, 'guitar').name).toBe('Guitar');
  });

  it('falls back to the shipped one rather than failing', () => {
    expect(resolveWorkspace(library, 'deleted').id).toBe(DEFAULT_WORKSPACE_ID);
    expect(resolveWorkspace(library, undefined).id).toBe(DEFAULT_WORKSPACE_ID);
  });
});

describe('listWorkspaces', () => {
  it('shows the shipped one first, then the rest by name', () => {
    const library = sanitizeWorkspaces({
      zebra: made({ id: 'zebra', name: 'Zebra' }),
      apple: made({ id: 'apple', name: 'Apple' }),
    });

    expect(listWorkspaces(library).map((workspace) => workspace.name)).toEqual(['Default', 'Apple', 'Zebra']);
  });
});

describe('findWorkspaceByName, which is how a spoken request lands', () => {
  const library = sanitizeWorkspaces({ guitar: made({ name: 'Guitar tab' }) });

  it('takes the name however it was said', () => {
    expect(findWorkspaceByName(library, '  GUITAR   TAB ')?.id).toBe('guitar');
    expect(findWorkspaceByName(library, 'guitar')?.id).toBe('guitar');
  });

  it('answers with nothing for a name it does not have, rather than guessing', () => {
    expect(findWorkspaceByName(library, 'piano')).toBeNull();
    expect(findWorkspaceByName(library, '  ')).toBeNull();
  });
});

describe('sharing one', () => {
  const workspace = made();

  it('round-trips through a file', () => {
    const result = importWorkspace(exportWorkspace(workspace));

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.workspace.name).toBe('Guitar');
  });

  it('stamps what it is, so an import can tell', () => {
    expect(exportWorkspace(workspace)).toContain(WORKSPACE_FILE_KIND);
  });

  /**
   * The failure that matters is not a malformed file — it is a well-formed one
   * that is not this at all, quietly rearranging somebody's app.
   */
  it('refuses a file that is not a workspace, however valid its JSON', () => {
    expect(importWorkspace('{"hello":"world"}')).toEqual({ ok: false, reason: 'not-a-workspace' });
    expect(importWorkspace('[1,2,3]')).toEqual({ ok: false, reason: 'not-a-workspace' });
  });

  it('refuses something that is not JSON at all', () => {
    expect(importWorkspace('not json')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('takes an imported copy of the shipped one as a copy, never as a replacement', () => {
    const result = importWorkspace(exportWorkspace(defaultWorkspace()));

    expect(result.ok === true && result.workspace.id).not.toBe(DEFAULT_WORKSPACE_ID);
    expect(result.ok === true && result.workspace.builtin).toBe(false);
  });

  it('names the file after the workspace, safely', () => {
    expect(workspaceFileName(made({ name: 'Gitar Tabı!' }))).toBe('gitar-tabı.foolspace.json');
    expect(workspaceFileName(made({ name: '   ' }))).toBe('workspace.foolspace.json');
  });
});

describe('normalizeWorkspaceName', () => {
  it('matches the way a name is said rather than the way it was typed', () => {
    expect(normalizeWorkspaceName('  Guitar   Tab ')).toBe('guitar tab');
  });
});
