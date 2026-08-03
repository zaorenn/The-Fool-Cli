import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import {
  SpeechToSpeechRuntime,
  type SpeechRuntimeChild,
  type SpeechRuntimeSpawnOptions,
} from './SpeechToSpeechRuntime';

const STARTUP_TIMEOUT_MS = 20 * 60 * 1000;
const POLL_INTERVAL_MS = 500;

const isPortOpen = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });

const firstExisting = async (candidates: readonly string[]): Promise<string | null> => {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next supported uv tool location.
    }
  }
  return null;
};

const resolvePythonPath = (): Promise<string | null> => {
  if (process.env.FOOL_SPEECH_TO_SPEECH_PYTHON) {
    return firstExisting([process.env.FOOL_SPEECH_TO_SPEECH_PYTHON]);
  }
  const home = homedir();
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(
            process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
            'uv',
            'tools',
            'speech-to-speech',
            'Scripts',
            'python.exe'
          ),
        ]
      : [
          path.join(home, '.local', 'share', 'uv', 'tools', 'speech-to-speech', 'bin', 'python'),
          path.join(home, 'Library', 'Application Support', 'uv', 'tools', 'speech-to-speech', 'bin', 'python'),
        ];
  return firstExisting(candidates);
};

const spawnRuntime = (
  command: string,
  args: readonly string[],
  options: SpeechRuntimeSpawnOptions
): SpeechRuntimeChild =>
  spawn(command, args, {
    env: options.env,
    windowsHide: options.windowsHide,
    stdio: ['ignore', 'ignore', 'pipe'],
  }) as SpeechRuntimeChild;

const waitForPort = async (port: number, child: SpeechRuntimeChild): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    if (await isPortOpen(port)) return;
    if (child.exitCode !== undefined && child.exitCode !== null) throw new Error('Speech runtime exited');
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('Speech runtime startup timed out');
};

export const speechToSpeechRuntime = new SpeechToSpeechRuntime({
  isPortOpen,
  resolvePythonPath,
  spawn: spawnRuntime,
  waitForPort,
});

export { SpeechToSpeechRuntime } from './SpeechToSpeechRuntime';
