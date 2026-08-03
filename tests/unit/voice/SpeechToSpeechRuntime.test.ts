import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  SpeechToSpeechRuntime,
  type SpeechRuntimeChild,
} from '@process/services/speech-to-speech/SpeechToSpeechRuntime';

class FakeChild extends EventEmitter implements SpeechRuntimeChild {
  readonly kill = vi.fn(() => true);
  readonly stderr = new EventEmitter();
}

describe('SpeechToSpeechRuntime', () => {
  it('reuses an already healthy loopback runtime', async () => {
    const spawn = vi.fn();
    const runtime = new SpeechToSpeechRuntime({
      isPortOpen: async () => true,
      resolvePythonPath: async () => 'python',
      spawn,
      waitForPort: vi.fn(),
    });

    await expect(runtime.ensureReady()).resolves.toEqual({
      endpoint: 'ws://127.0.0.1:8765/v1/realtime',
      reused: true,
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('starts the pinned local CUDA pipeline on loopback and waits until ready', async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child);
    const waitForPort = vi.fn(async () => undefined);
    const runtime = new SpeechToSpeechRuntime({
      isPortOpen: async () => false,
      resolvePythonPath: async () => 'C:\\runtime\\python.exe',
      spawn,
      waitForPort,
    });

    await expect(runtime.ensureReady()).resolves.toEqual({
      endpoint: 'ws://127.0.0.1:8765/v1/realtime',
      reused: false,
    });
    expect(spawn).toHaveBeenCalledWith(
      'C:\\runtime\\python.exe',
      expect.arrayContaining([
        '-m',
        'speech_to_speech.s2s_pipeline',
        '--ws_host',
        '127.0.0.1',
        '--ws_port',
        '8765',
        '--device',
        'cuda',
      ]),
      expect.objectContaining({ env: expect.objectContaining({ PYTHONUTF8: '1' }) })
    );
    expect(waitForPort).toHaveBeenCalledWith(8765, child);
  });

  it('reports missing runtime without spawning an unrelated command', async () => {
    const spawn = vi.fn();
    const runtime = new SpeechToSpeechRuntime({
      isPortOpen: async () => false,
      resolvePythonPath: async () => null,
      spawn,
      waitForPort: vi.fn(),
    });

    await expect(runtime.ensureReady()).rejects.toThrow('SPEECH_RUNTIME_MISSING');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('surfaces startup output when the child exits before opening the port', async () => {
    const child = new FakeChild();
    const runtime = new SpeechToSpeechRuntime({
      isPortOpen: async () => false,
      resolvePythonPath: async () => 'python',
      spawn: () => child,
      waitForPort: async () => {
        child.stderr.emit('data', Buffer.from('model load failed'));
        throw new Error('process exited');
      },
    });

    await expect(runtime.ensureReady()).rejects.toThrow('model load failed');
  });
});
