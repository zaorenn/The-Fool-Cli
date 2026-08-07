/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultWorkspace, type Workspace } from '@/common/config/workspaces';

/**
 * The second half of an import.
 *
 * A workspace carries its own page, so nothing about the app itself can arrive
 * incomplete. What can is what it depends on. Without this a received workspace
 * opens, looks correct, and fails the first time somebody presses the button —
 * which reads as the app being broken rather than as an import that is not
 * finished.
 */

let library: { name: string }[] = [];
const briefs: string[] = [];
let taskOk = true;

vi.mock('@/common', () => ({
  ipcBridge: { fs: { listAvailableSkills: { invoke: async () => library } } },
}));

vi.mock('@renderer/services/voice/session/runAgentTask', () => ({
  runAgentTask: async ({ request }: { request: string }) => {
    briefs.push(request);
    return taskOk
      ? { ok: true, conversationId: 'c1', summary: 'installed' }
      : { ok: false, reason: 'run-failed', detail: 'no network' };
  },
}));

vi.mock('@renderer/services/voice/session/voiceMemoryStore', () => ({ peekVoiceMemory: () => ({}) }));
vi.mock('@renderer/services/voice/voiceSettingsStore', () => ({ peekVoiceSettings: () => ({}) }));

const { fetchMissingSkills, missingSkills } = await import('@renderer/pages/hub/fetchMissingSkills');

const needing = (...skills: string[]): Workspace => ({
  ...defaultWorkspace(),
  id: 'guitar',
  name: 'Guitar',
  builtin: false,
  app: { folder: 'guitar', title: 'Guitar', entry: 'index.html', requiresSkills: skills },
});

beforeEach(() => {
  library = [];
  briefs.length = 0;
  taskOk = true;
});

describe('missingSkills', () => {
  it('names what the workspace expects and the library does not have', async () => {
    library = [{ name: 'screen-sense' }];

    expect(await missingSkills(needing('screen-sense', 'tab-reader'))).toEqual(['tab-reader']);
  });

  it('matches however the name was cased or spaced', async () => {
    library = [{ name: '  Tab-Reader ' }];

    expect(await missingSkills(needing('tab-reader'))).toEqual([]);
  });

  it('has nothing to fetch for a workspace with no page, or a page needing nothing', async () => {
    expect(await missingSkills(defaultWorkspace())).toEqual([]);
    expect(await missingSkills(needing())).toEqual([]);
  });

  /**
   * The safe way round: offering to fetch something already installed wastes a
   * minute, and skipping something that is not there breaks the workspace.
   */
  it('treats an unreadable library as an empty one', async () => {
    library = [];
    expect(await missingSkills(needing('tab-reader'))).toEqual(['tab-reader']);
  });
});

describe('fetchMissingSkills', () => {
  it('does nothing at all when nothing is missing', async () => {
    expect(await fetchMissingSkills(needing(), [])).toEqual({ ok: true, installed: [] });
    expect(briefs).toEqual([]);
  });

  it('asks for exactly what was named, and says not to invent one', async () => {
    library = [{ name: 'tab-reader' }];
    await fetchMissingSkills(needing('tab-reader'), ['tab-reader']);

    expect(briefs).toHaveLength(1);
    expect(briefs[0]).toContain('- tab-reader');
    expect(briefs[0]).toContain('Install exactly those and nothing else');
    expect(briefs[0]).toContain('Do not invent a skill');
  });

  /**
   * The agent reports what it did; what matters is what is in the library now.
   * Those are not the same thing, and only one of them can be checked.
   */
  it('checks the library rather than believing the report', async () => {
    // The agent says it worked, and the library says otherwise.
    library = [];
    expect(await fetchMissingSkills(needing('tab-reader'), ['tab-reader'])).toEqual({ ok: true, installed: [] });

    library = [{ name: 'tab-reader' }];
    expect(await fetchMissingSkills(needing('tab-reader'), ['tab-reader'])).toEqual({
      ok: true,
      installed: ['tab-reader'],
    });
  });

  it('reports a failure rather than claiming the workspace is ready', async () => {
    taskOk = false;

    expect(await fetchMissingSkills(needing('tab-reader'), ['tab-reader'])).toEqual({
      ok: false,
      error: 'no network',
    });
  });
});
