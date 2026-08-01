/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  AudioCppRuntime,
  AudioCppRuntimeError,
  type AudioCppChildProcess,
  type AudioCppRuntimeOptions,
} from '@process/services/fool-voice/audiocpp/AudioCppRuntime';

/** A child process that never exists: every test drives its lifecycle by hand. */
type FakeChild = AudioCppChildProcess & {
  readonly args: readonly string[];
  readonly kills: string[];
  /** Fires the `exit` listeners, as a crash or a kill would. */
  exit: () => void;
};

const makeChild = (args: readonly string[]): FakeChild => {
  const listeners: Array<() => void> = [];
  let alive = true;
  return {
    args,
    kills: [],
    pid: 4242,
    once(event: 'exit', listener: () => void) {
      if (event === 'exit') listeners.push(listener);
      return this;
    },
    kill(signal?: NodeJS.Signals) {
      this.kills.push(signal ?? 'SIGTERM');
      if (!alive) return false;
      alive = false;
      // A real kill delivers `exit` asynchronously; mirror that so shutdown has to wait.
      setTimeout(() => listeners.splice(0).forEach((listener) => listener()), 0);
      return true;
    },
    exit() {
      alive = false;
      listeners.splice(0).forEach((listener) => listener());
    },
  };
};

type Harness = {
  runtime: AudioCppRuntime;
  children: FakeChild[];
  spawn: ReturnType<typeof vi.fn>;
  probeHealth: ReturnType<typeof vi.fn>;
  writes: Array<{ path: string; contents: string }>;
  ports: number[];
};

const makeHarness = (overrides: Partial<AudioCppRuntimeOptions> = {}, healthy: () => boolean = () => true): Harness => {
  const children: FakeChild[] = [];
  const writes: Array<{ path: string; contents: string }> = [];
  const ports: number[] = [];
  let nextPort = 50000;

  const spawn = vi.fn((_binary: string, args: readonly string[]) => {
    const child = makeChild(args);
    children.push(child);
    return child;
  });
  const probeHealth = vi.fn(async () => healthy());

  const runtime = new AudioCppRuntime({
    binaryPath: 'C:\\engines\\audiocpp\\audiocpp_server.exe',
    configPath: 'C:\\engines\\audiocpp\\server.json',
    models: [{ id: 'chatterbox', family: 'chatterbox', path: 'C:\\models\\chatterbox', task: 'clon' }],
    startupTimeoutMs: 1000,
    healthIntervalMs: 10,
    maxRestarts: 2,
    restartWindowMs: 60_000,
    spawn,
    probeHealth,
    writeConfigFile: async (path, contents) => {
      writes.push({ path, contents });
    },
    allocatePort: async () => {
      nextPort += 1;
      ports.push(nextPort);
      return nextPort;
    },
    // Instant, but still a macrotask: a synchronously-resolving stub would starve
    // the timer queue, and the fake child's `exit` would never get a chance to fire.
    delay: async () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    ...overrides,
  });

  return { runtime, children, spawn, probeHealth, writes, ports };
};

/** Lets queued microtasks and zero-delay timers drain, so an eager restart can land. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('AudioCppRuntime.ensureRunning', () => {
  it('spawns the server bound to loopback only and resolves its base URL', async () => {
    const harness = makeHarness();

    const { baseUrl } = await harness.runtime.ensureRunning();

    expect(harness.spawn).toHaveBeenCalledTimes(1);
    const args = harness.children[0].args;
    expect(args).toContain('--config');
    // `--host` must be the loopback literal: the server parses it with inet_pton and
    // binds exactly what it is given, so anything else exposes the engine on the LAN.
    expect(args[args.indexOf('--host') + 1]).toBe('127.0.0.1');
    expect(args).not.toContain('0.0.0.0');
    expect(baseUrl).toBe(`http://127.0.0.1:${harness.ports[0]}`);
  });

  it('writes a server config pinned to loopback, the chosen port and a CPU backend', async () => {
    const harness = makeHarness();

    await harness.runtime.ensureRunning();

    expect(harness.writes).toHaveLength(1);
    expect(harness.writes[0].path).toBe('C:\\engines\\audiocpp\\server.json');
    const config = JSON.parse(harness.writes[0].contents) as Record<string, unknown>;
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(harness.ports[0]);
    // The upstream default is `cuda`; a CPU-only package has to say so explicitly.
    expect(config.backend).toBe('cpu');
    // Without lazy loading the process loads every model before it starts listening,
    // and the health poll would time out on a cold start.
    expect(config.lazy_load).toBe(true);
    expect(config.models).toEqual([
      { id: 'chatterbox', family: 'chatterbox', path: 'C:\\models\\chatterbox', task: 'clon', mode: 'offline' },
    ]);
  });

  it('is idempotent: a second call reuses the running process', async () => {
    const harness = makeHarness();

    const first = await harness.runtime.ensureRunning();
    const second = await harness.runtime.ensureRunning();

    expect(harness.spawn).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('shares one startup between concurrent callers instead of racing into two processes', async () => {
    const harness = makeHarness();

    const results = await Promise.all([
      harness.runtime.ensureRunning(),
      harness.runtime.ensureRunning(),
      harness.runtime.ensureRunning(),
    ]);

    expect(harness.spawn).toHaveBeenCalledTimes(1);
    expect(harness.writes).toHaveLength(1);
    expect(new Set(results.map((result) => result.baseUrl)).size).toBe(1);
  });

  it('polls /health until the server answers, then resolves', async () => {
    let answers = 0;
    const harness = makeHarness({}, () => {
      answers += 1;
      return answers >= 3;
    });

    await harness.runtime.ensureRunning();

    expect(harness.probeHealth).toHaveBeenCalledTimes(3);
    expect(harness.probeHealth).toHaveBeenLastCalledWith(`http://127.0.0.1:${harness.ports[0]}`);
  });

  it('treats a probe that throws as "not ready yet" rather than as a failure', async () => {
    const harness = makeHarness();
    harness.probeHealth.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce(true);

    await expect(harness.runtime.ensureRunning()).resolves.toEqual({
      baseUrl: `http://127.0.0.1:${harness.ports[0]}`,
    });
  });

  it('gives up on a bounded timeout and kills the child that never became healthy', async () => {
    let now = 0;
    const harness = makeHarness({ now: () => (now += 100) }, () => false);

    const error = (await harness.runtime.ensureRunning().catch((thrown: unknown) => thrown)) as AudioCppRuntimeError;

    expect(error).toBeInstanceOf(AudioCppRuntimeError);
    expect(error.kind).toBe('startup-timeout');
    // A process that never became healthy must not be left behind.
    expect(harness.children[0].kills.length).toBeGreaterThan(0);
  });

  it('surfaces a process that dies while still starting up', async () => {
    const harness = makeHarness({}, () => false);
    const pending = harness.runtime.ensureRunning();
    await settle();
    harness.children[0].exit();

    const error = (await pending.catch((thrown: unknown) => thrown)) as AudioCppRuntimeError;

    expect(error.kind).toBe('exited-during-startup');
  });

  it('retries after a failed startup instead of caching the rejection forever', async () => {
    let healthy = false;
    let now = 0;
    const harness = makeHarness({ now: () => (now += 100) }, () => healthy);

    await expect(harness.runtime.ensureRunning()).rejects.toBeInstanceOf(AudioCppRuntimeError);
    healthy = true;
    await expect(harness.runtime.ensureRunning()).resolves.toBeDefined();
    expect(harness.spawn).toHaveBeenCalledTimes(2);
  });
});

describe('AudioCppRuntime restart bounds', () => {
  it('restarts the server when it exits unexpectedly', async () => {
    const harness = makeHarness();
    await harness.runtime.ensureRunning();

    harness.children[0].exit();
    await settle();

    expect(harness.spawn).toHaveBeenCalledTimes(2);
    await expect(harness.runtime.ensureRunning()).resolves.toBeDefined();
  });

  it('stops restarting after the bound and surfaces a typed failure from then on', async () => {
    const harness = makeHarness();
    await harness.runtime.ensureRunning();

    // maxRestarts is 2: two crashes are absorbed, the third gives up.
    for (let i = 0; i < 3; i += 1) {
      harness.children[harness.children.length - 1].exit();
      await settle();
    }

    expect(harness.spawn).toHaveBeenCalledTimes(3);

    const error = (await harness.runtime.ensureRunning().catch((thrown: unknown) => thrown)) as AudioCppRuntimeError;
    expect(error).toBeInstanceOf(AudioCppRuntimeError);
    expect(error.kind).toBe('restart-limit');
    // Still down, and staying down: no further spawn from the failed call.
    expect(harness.spawn).toHaveBeenCalledTimes(3);
  });

  it('forgives crashes that fall outside the restart window', async () => {
    let now = 0;
    const harness = makeHarness({ now: () => now, restartWindowMs: 1000 });
    await harness.runtime.ensureRunning();

    for (let i = 0; i < 4; i += 1) {
      now += 5000;
      harness.children[harness.children.length - 1].exit();
      await settle();
    }

    // Each crash is alone in its window, so the budget never fills.
    expect(harness.spawn).toHaveBeenCalledTimes(5);
    await expect(harness.runtime.ensureRunning()).resolves.toBeDefined();
  });
});

describe('AudioCppRuntime.shutdown', () => {
  it('kills the child and waits for it to exit', async () => {
    const harness = makeHarness();
    await harness.runtime.ensureRunning();

    await harness.runtime.shutdown();

    expect(harness.children[0].kills.length).toBeGreaterThan(0);
    expect(harness.runtime.isRunning()).toBe(false);
  });

  it('does not treat its own kill as a crash worth restarting', async () => {
    const harness = makeHarness();
    await harness.runtime.ensureRunning();

    await harness.runtime.shutdown();
    await settle();

    expect(harness.spawn).toHaveBeenCalledTimes(1);
  });

  it('is safe to call when nothing is running, and twice in a row', async () => {
    const harness = makeHarness();

    await expect(harness.runtime.shutdown()).resolves.toBeUndefined();
    await harness.runtime.ensureRunning();
    await harness.runtime.shutdown();
    await expect(harness.runtime.shutdown()).resolves.toBeUndefined();
  });

  it('stops a startup that is still in flight rather than leaking the child', async () => {
    const harness = makeHarness({}, () => false);
    const pending = harness.runtime.ensureRunning();
    await settle();

    await harness.runtime.shutdown();

    await expect(pending).rejects.toBeInstanceOf(AudioCppRuntimeError);
    expect(harness.children[0].kills.length).toBeGreaterThan(0);
  });

  it('clears a restart-limit failure so the engine can be started again deliberately', async () => {
    const harness = makeHarness();
    await harness.runtime.ensureRunning();
    for (let i = 0; i < 3; i += 1) {
      harness.children[harness.children.length - 1].exit();
      await settle();
    }
    await expect(harness.runtime.ensureRunning()).rejects.toBeInstanceOf(AudioCppRuntimeError);

    await harness.runtime.shutdown();

    await expect(harness.runtime.ensureRunning()).resolves.toBeDefined();
  });
});
