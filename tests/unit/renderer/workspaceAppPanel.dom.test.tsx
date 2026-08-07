/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_APP_CHANNEL, type WorkspaceApp } from '@/common/config/workspaceApp';

/**
 * The door between a generated page and the rest of the app.
 *
 * The page inside a workspace is written by a model from something somebody said
 * out loud, served over loopback, and then given the user's agent. This panel is
 * the only thing between those two facts, which makes it the piece worth testing
 * hardest — and the assertions that matter are the refusals.
 */

const asked: string[] = [];
const opened: string[] = [];
const spoken: string[] = [];

vi.mock('@renderer/services/voice/session/runAgentTask', () => ({
  runAgentTask: async ({ request }: { request: string }) => {
    asked.push(request);
    return { ok: true, conversationId: 'c1', summary: `did: ${request}` };
  },
}));

vi.mock('@renderer/services/voice/session/voiceMemoryStore', () => ({ peekVoiceMemory: () => ({}) }));
vi.mock('@renderer/services/voice/voiceSettingsStore', () => ({
  peekVoiceSettings: () => ({ narrator: { maxSpokenCharacters: 400 } }),
}));
vi.mock('@renderer/services/voice/speakText', () => ({
  speakText: async ({ text }: { text: string }) => {
    spoken.push(text);
    return { spoken: true };
  },
}));
vi.mock('@renderer/services/voice/speechPlayer', () => ({ getSpeechPlayer: () => ({}) }));
vi.mock('@/common', () => ({
  ipcBridge: { shell: { openExternal: { invoke: async (url: string) => void opened.push(url) } } },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const WorkspaceAppPanel = (await import('@renderer/pages/hub/WorkspaceAppPanel')).default;

const app: WorkspaceApp = { folder: 'guitar', title: 'Guitar Tab', entry: 'index.html', requiresSkills: [] };

/** Stands in for the served page, so a message can be posted as it would be. */
const fakeFrameWindow = { postMessage: vi.fn() };

beforeEach(() => {
  asked.length = 0;
  opened.length = 0;
  spoken.length = 0;
  fakeFrameWindow.postMessage.mockClear();

  vi.stubGlobal('window', window);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    serveWorkspaceApp: async () => ({ ok: true, url: 'http://127.0.0.1:5555/index.html', root: 'C:/x/guitar' }),
    stopWorkspaceApp: async () => {},
  };
});

/** Posts a message as the served page would, and lets the handler settle. */
const post = async (payload: Record<string, unknown>): Promise<void> => {
  const frame = screen.getByTestId('workspace-app-frame') as HTMLIFrameElement;
  Object.defineProperty(frame, 'contentWindow', { value: fakeFrameWindow, configurable: true });

  window.dispatchEvent(
    new MessageEvent('message', {
      data: { channel: WORKSPACE_APP_CHANNEL, ...payload },
      source: fakeFrameWindow as never,
    })
  );
  await waitFor(() => expect(true).toBe(true));
};

describe('a workspace’s page', () => {
  it('is served over loopback and shown in a sandboxed frame', async () => {
    render(<WorkspaceAppPanel app={app} workspaceId='guitar' />);

    await waitFor(() => expect(screen.getByTestId('workspace-app-frame')).toBeTruthy());
    const frame = screen.getByTestId('workspace-app-frame') as HTMLIFrameElement;

    expect(frame.getAttribute('src')).toMatch(/^http:\/\/127\.0\.0\.1:/);
    // Scripts because it is an app; nothing that would let it out of the frame.
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
  });

  it('says what went wrong rather than showing an empty frame', async () => {
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI.serveWorkspaceApp = async () => ({
      ok: false,
      reason: 'no-entry',
    });

    render(<WorkspaceAppPanel app={app} workspaceId='guitar' />);

    await waitFor(() => expect(screen.getByText('hub.appError.no-entry')).toBeTruthy());
    expect(screen.queryByTestId('workspace-app-frame')).toBeNull();
  });
});

describe('what the page may ask for', () => {
  it('hands a job to the agent and answers with what it wrote', async () => {
    render(<WorkspaceAppPanel app={app} workspaceId='guitar' />);
    await waitFor(() => expect(screen.getByTestId('workspace-app-frame')).toBeTruthy());

    await post({ id: 'r1', kind: 'ask', prompt: 'find the tab' });

    await waitFor(() => expect(asked).toEqual(['find the tab']));
    await waitFor(() =>
      expect(fakeFrameWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'r1', ok: true, result: 'did: find the tab' }),
        '*'
      )
    );
  });

  it('opens a web address in the user’s own browser', async () => {
    render(<WorkspaceAppPanel app={app} workspaceId='guitar' />);
    await waitFor(() => expect(screen.getByTestId('workspace-app-frame')).toBeTruthy());

    await post({ id: 'r2', kind: 'open', url: 'https://example.com' });

    await waitFor(() => expect(opened).toEqual(['https://example.com']));
  });

  /**
   * `openExternal` hands anything that is not the web to whatever the system
   * registered for the scheme, and this argument came from a generated page.
   */
  it('refuses anything that is not a web address, without answering', async () => {
    render(<WorkspaceAppPanel app={app} workspaceId='guitar' />);
    await waitFor(() => expect(screen.getByTestId('workspace-app-frame')).toBeTruthy());

    await post({ id: 'r3', kind: 'open', url: 'file:///C:/Windows/System32' });

    expect(opened).toEqual([]);
    expect(fakeFrameWindow.postMessage).not.toHaveBeenCalled();
  });

  it('drops a kind it does not have, without answering', async () => {
    render(<WorkspaceAppPanel app={app} workspaceId='guitar' />);
    await waitFor(() => expect(screen.getByTestId('workspace-app-frame')).toBeTruthy());

    await post({ id: 'r4', kind: 'exec', command: 'rm -rf /' });

    expect(asked).toEqual([]);
    expect(fakeFrameWindow.postMessage).not.toHaveBeenCalled();
  });

  /**
   * Any other window posting at us is not the app, whatever its message claims.
   */
  it('ignores a message that did not come from the page it is showing', async () => {
    render(<WorkspaceAppPanel app={app} workspaceId='guitar' />);
    await waitFor(() => expect(screen.getByTestId('workspace-app-frame')).toBeTruthy());

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { channel: WORKSPACE_APP_CHANNEL, id: 'r5', kind: 'ask', prompt: 'from somewhere else' },
        source: { postMessage: vi.fn() } as never,
      })
    );
    await waitFor(() => expect(true).toBe(true));

    expect(asked).toEqual([]);
  });

  it('keeps what an app stores under its own workspace, not everybody’s', async () => {
    render(<WorkspaceAppPanel app={app} workspaceId='guitar' />);
    await waitFor(() => expect(screen.getByTestId('workspace-app-frame')).toBeTruthy());

    await post({ id: 'r6', kind: 'store', key: 'last', value: 'Wonderwall' });

    expect(window.localStorage.getItem('fool.workspace.guitar.last')).toBe('Wonderwall');
  });
});
