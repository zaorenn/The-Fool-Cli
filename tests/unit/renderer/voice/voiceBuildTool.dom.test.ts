/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationActivity, ToolHost } from '@renderer/pages/voice/runtime/types';

/**
 * "Build me a web app" — all the way to looking at it.
 *
 * Handing the request to the agent was already possible and left the user with a
 * folder path they had been told about in a sentence: the thing they asked for
 * existed and they could not see it.
 */

const runAgentTask = vi.fn();
const openExternal = vi.fn();
const servePreview = vi.fn();

vi.mock('@renderer/services/voice/session/runAgentTask', () => ({
  runAgentTask: (request: unknown) => runAgentTask(request),
}));
vi.mock('@renderer/services/voice/voiceSettingsStore', () => ({ peekVoiceSettings: () => ({}) }));
vi.mock('@/common', () => ({
  ipcBridge: { shell: { openExternal: { invoke: (url: string) => openExternal(url) } } },
}));

const { buildAndPreview, buildBrief, workspaceSlug } = await import('@renderer/pages/voice/runtime/buildTool');

const activities = new Map<string, ConversationActivity>();

const host: ToolHost = {
  t: (key, values) => (values ? `${key}:${Object.values(values).join(',')}` : key),
  updateActivity: (id, patch) => {
    const existing = activities.get(id) ?? { id, label: '', detail: '', state: 'running' };
    activities.set(id, { ...existing, ...patch });
  },
  backToListening: vi.fn(),
  flushOutput: vi.fn(),
  setStandby: vi.fn(),
  startWorkingHeartbeat: () => () => {},
};

describe('workspaceSlug', () => {
  const at = Date.parse('2026-08-06T19:30:00.000Z');

  it('makes a folder name out of what was asked for', () => {
    expect(workspaceSlug('build me a macOS style notes app', at)).toBe(
      'build-me-a-macos-style-notes-app-20260806193000'
    );
  });

  it('falls back to a plain name when the request is in another script', () => {
    expect(workspaceSlug('bana bir uygulama yap', at)).toBe('bana-bir-uygulama-yap-20260806193000');
    expect(workspaceSlug('给我做一个应用', at)).toBe('app-20260806193000');
  });

  it('never ends in the separator, whatever was trimmed off', () => {
    expect(workspaceSlug('a!!!', at).startsWith('a-2')).toBe(true);
  });
});

describe('buildBrief', () => {
  it('names the folder, so nothing has to be worked out afterwards', () => {
    const brief = buildBrief('a notes app', 'C:/apps/notes');

    expect(brief).toContain('C:/apps/notes');
    expect(brief).toContain('index.html');
  });

  it('rules out the build step that would make it unopenable', () => {
    const brief = buildBrief('a notes app', 'C:/apps/notes');

    expect(brief).toContain('no build step');
    expect(brief).toContain('no npm install');
  });

  it('keeps the request itself at the top, in the user’s own words', () => {
    expect(buildBrief('make it macOS style', 'C:/apps/x').startsWith('make it macOS style')).toBe(true);
  });
});

describe('buildAndPreview', () => {
  beforeEach(() => {
    activities.clear();
    runAgentTask.mockReset();
    openExternal.mockReset();
    servePreview.mockReset();
    vi.stubGlobal('window', {
      electronAPI: {
        previewWorkspaceRoot: async () => 'C:\\Users\\me\\AppData\\fool\\built-apps',
        servePreview: (directory: string) => servePreview(directory),
      },
    });
  });

  it('builds inside the folder it chose, and opens what came out', async () => {
    runAgentTask.mockResolvedValue({ ok: true, conversationId: 'c1', summary: 'A notes app.' });
    servePreview.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:51234/' });

    const result = await buildAndPreview(host, 'call-1', 'a notes app');

    expect(result).toMatchObject({ ok: true, url: 'http://127.0.0.1:51234/' });
    expect(openExternal).toHaveBeenCalledWith('http://127.0.0.1:51234/');

    // The same folder in the brief and in the request to serve — the one step
    // that used to be guesswork.
    const asked = String(runAgentTask.mock.calls[0][0].request);
    expect(asked).toContain(String(servePreview.mock.calls[0][0]).replaceAll('\\', '/'));
  });

  it('uses forward slashes in the brief, because backslashes do not survive a prompt', async () => {
    runAgentTask.mockResolvedValue({ ok: true, conversationId: 'c1', summary: 'done' });
    servePreview.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:1/' });

    await buildAndPreview(host, 'call-1', 'a notes app');

    expect(String(runAgentTask.mock.calls[0][0].request)).not.toContain('\\');
  });

  it('says the build failed rather than promising an app that is not there', async () => {
    runAgentTask.mockResolvedValue({ ok: false, reason: 'run-failed', detail: 'no agent' });

    const result = await buildAndPreview(host, 'call-1', 'a notes app');

    expect(result.ok).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
    expect(activities.get('call-1')?.state).toBe('failed');
  });

  it('reports a build that finished with nothing to open, instead of claiming success', async () => {
    runAgentTask.mockResolvedValue({ ok: true, conversationId: 'c1', summary: 'I made it.' });
    servePreview.mockResolvedValue({ ok: false, reason: 'no-entry' });

    const result = await buildAndPreview(host, 'call-1', 'a notes app');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('conversationBuildNoEntry');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('gives the floor back before it starts waiting, so talking can carry on', async () => {
    runAgentTask.mockResolvedValue({ ok: true, conversationId: 'c1', summary: 'done' });
    servePreview.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:1/' });

    await buildAndPreview(host, 'call-1', 'a notes app');

    expect(host.backToListening).toHaveBeenCalled();
  });

  it('keeps each thing the agent reported as its own line', async () => {
    runAgentTask.mockImplementation(async (request: { onProgress?: (detail: string) => void }) => {
      request.onProgress?.('writing index.html');
      request.onProgress?.('writing the stylesheet');
      return { ok: true, conversationId: 'c1', summary: 'done' };
    });
    servePreview.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:1/' });

    await buildAndPreview(host, 'call-1', 'a notes app');

    const steps = [...activities.values()].filter((item) => item.id.includes('#'));
    expect(steps.map((item) => item.detail)).toEqual(['writing index.html', 'writing the stylesheet']);
  });
});
