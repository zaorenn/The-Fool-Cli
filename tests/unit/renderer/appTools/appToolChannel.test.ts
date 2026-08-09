/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (message: unknown) => void | Promise<void>;

const listeners: Listener[] = [];
const reconnectListeners: (() => void)[] = [];
const postResult = vi.fn(async () => undefined);
const postCatalogue = vi.fn(async () => undefined);
const runVoiceTool = vi.fn(async () => ({ ok: true, screen: 'a browser' }) as Record<string, unknown>);

vi.mock('@/common', () => ({
  ipcBridge: {
    appTools: {
      request: {
        on: (callback: Listener) => {
          listeners.push(callback);
          return () => {
            const index = listeners.indexOf(callback);
            if (index >= 0) listeners.splice(index, 1);
          };
        },
      },
      result: { invoke: postResult },
      catalogue: { invoke: postCatalogue },
    },
    realtime: {
      reconnected: {
        on: (callback: () => void) => {
          reconnectListeners.push(callback);
          return () => {
            const index = reconnectListeners.indexOf(callback);
            if (index >= 0) reconnectListeners.splice(index, 1);
          };
        },
      },
    },
  },
}));

vi.mock('@renderer/pages/voice/runtime/toolRunner', () => ({ runVoiceTool }));

const { startAppToolChannel } = await import('@renderer/services/appTools/appToolChannel');

const request = (callId: string, name = 'app_look_at_screen'): Record<string, unknown> => ({
  conversation_id: 'c1',
  call_id: callId,
  name,
  arguments: {},
});

describe('startAppToolChannel', () => {
  beforeEach(() => {
    listeners.length = 0;
    reconnectListeners.length = 0;
    postResult.mockClear();
    postCatalogue.mockClear();
    runVoiceTool.mockClear();
    runVoiceTool.mockResolvedValue({ ok: true, screen: 'a browser' });
  });

  it('registers what the application can do when it starts', () => {
    startAppToolChannel();
    expect(postCatalogue).toHaveBeenCalledWith(
      expect.objectContaining({ tools: expect.arrayContaining([expect.objectContaining({ name: 'app_theme' })]) })
    );
  });

  it('runs the tool and posts the result back', async () => {
    startAppToolChannel();
    await listeners[0](request('call-1'));

    expect(runVoiceTool).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ callId: 'call-1', name: 'app_look_at_screen', argumentsJson: '{}' })
    );
    expect(postResult).toHaveBeenCalledWith(expect.objectContaining({ call_id: 'call-1', ok: true }));
  });

  it('posts a failure rather than nothing when the handler throws', async () => {
    runVoiceTool.mockRejectedValueOnce(new Error('no screen'));
    startAppToolChannel();
    await listeners[0](request('call-2'));

    expect(postResult).toHaveBeenCalledWith(
      expect.objectContaining({ call_id: 'call-2', ok: false, content: 'no screen' })
    );
  });

  it('reports a tool that failed on its own terms as a failure', async () => {
    runVoiceTool.mockResolvedValueOnce({ ok: false, error: 'nothing to look at' });
    startAppToolChannel();
    await listeners[0](request('call-3'));

    expect(postResult).toHaveBeenCalledWith(expect.objectContaining({ call_id: 'call-3', ok: false }));
  });

  it('answers exactly once per request', async () => {
    startAppToolChannel();
    await listeners[0](request('call-4'));
    expect(postResult).toHaveBeenCalledTimes(1);
  });

  it('registers again when the backend comes back', () => {
    // The catalogue lives in the backend's memory. A backend that restarted has
    // forgotten it, and an agent would be told this application can do nothing.
    startAppToolChannel();
    postCatalogue.mockClear();

    reconnectListeners.forEach((listener) => listener());

    expect(postCatalogue).toHaveBeenCalledTimes(1);
  });

  it('stops answering once it is torn down', () => {
    const stop = startAppToolChannel();
    stop();
    expect(listeners).toHaveLength(0);
    expect(reconnectListeners).toHaveLength(0);
  });
});

describe('startAppToolChannel and the permission layer', () => {
  beforeEach(() => {
    listeners.length = 0;
    reconnectListeners.length = 0;
    postResult.mockClear();
    postCatalogue.mockClear();
    runVoiceTool.mockClear();
    runVoiceTool.mockResolvedValue({ ok: true, screen: 'a browser' });
  });

  it('refuses a call nobody wrote a rule for, without running it', async () => {
    startAppToolChannel();
    await listeners[0](request('call-9', 'app_delete_everything'));

    expect(runVoiceTool).not.toHaveBeenCalled();
    // Still exactly one answer. Silence here is the same failure as a timeout:
    // an agent waiting on a tool that will never come back.
    expect(postResult).toHaveBeenCalledWith(expect.objectContaining({ call_id: 'call-9', ok: false }));
  });

  it('runs a tool the rules allow', async () => {
    startAppToolChannel();
    await listeners[0](request('call-10', 'app_look_at_screen'));

    expect(runVoiceTool).toHaveBeenCalled();
    expect(postResult).toHaveBeenCalledWith(expect.objectContaining({ call_id: 'call-10', ok: true }));
  });
});
