import { beforeEach, describe, expect, it } from 'vitest';
import { bridge } from '@/common/platform/bridge';
import { ipcBridge } from '@/common';
import { initFoolVoiceBridge } from '@/process/bridge/foolVoiceBridge';

const connectLoopback = (): void => {
  let incoming: { emit: (name: string, data: unknown) => unknown } | undefined;
  bridge.adapter({
    emit: (name, data) => incoming?.emit(name, data),
    on: (emitter) => {
      incoming = emitter;
    },
  });
};

describe('speech runtime bridge', () => {
  beforeEach(connectLoopback);

  it('returns the managed realtime endpoint after the runtime is ready', async () => {
    initFoolVoiceBridge({
      ensureRealtime: async () => ({
        endpoint: 'ws://127.0.0.1:8765/v1/realtime',
        reused: false,
      }),
    });

    await expect(
      ipcBridge.foolVoice.ensureRealtime.invoke({
        version: 1,
        requestId: 'runtime-1',
        payload: {},
      })
    ).resolves.toEqual({
      version: 1,
      requestId: 'runtime-1',
      ok: true,
      data: { endpoint: 'ws://127.0.0.1:8765/v1/realtime', reused: false },
    });
  });

  it('rejects unexpected runtime request fields', async () => {
    initFoolVoiceBridge({ ensureRealtime: async () => ({ endpoint: '', reused: false }) });

    await expect(
      ipcBridge.foolVoice.ensureRealtime.invoke({
        version: 1,
        requestId: 'runtime-2',
        payload: { endpoint: 'ws://attacker.invalid' },
      } as never)
    ).resolves.toEqual({
      version: 1,
      requestId: 'runtime-2',
      ok: false,
      error: { code: 'invalid-request', retryable: false },
    });
  });
});
