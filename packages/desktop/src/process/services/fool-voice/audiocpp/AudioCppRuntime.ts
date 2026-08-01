/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn as spawnChildProcess } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';

/**
 * Supervises the `audiocpp_server` child process.
 *
 * The only part of the integration that touches `child_process`, which is what
 * keeps {@link AudioCppClient} testable against a stub server. Every external
 * effect — spawning, port allocation, writing the config, probing health — is
 * injectable, so the tests never launch a real binary.
 *
 * Contract details this class encodes, pinned in
 * `docs/superpowers/specs/2026-08-01-audiocpp-http-contract.md`:
 *
 * - `--config <server.json>` is **required**; there is no `--model-dir`, so the
 *   supervisor has to write a config file before it can spawn anything.
 * - `--host` is parsed with `inet_pton` and bound verbatim, so `127.0.0.1` keeps
 *   the engine off the network and `localhost` is rejected outright.
 * - The backend defaults to `cuda`; a CPU package must say `cpu` or fail at load.
 * - Port 0 would bind an ephemeral port the server never reports back, so the
 *   free port has to be chosen here.
 */

/** The slice of a Node child process this supervisor uses. */
export type AudioCppChildProcess = {
  readonly pid?: number;
  once: (event: 'exit', listener: () => void) => unknown;
  kill: (signal?: NodeJS.Signals) => boolean;
};

export type AudioCppSpawn = (binaryPath: string, args: readonly string[]) => AudioCppChildProcess;

/** One entry of the server config's `models` array. */
export type AudioCppServerModel = {
  /** The id requests address this model by. Arbitrary; ours to choose. */
  id: string;
  /** Upstream family name, e.g. `chatterbox`. */
  family: string;
  /** Absolute path to the model directory. */
  path: string;
  /**
   * Framework task spelling. Chatterbox needs `clon` — its loader rejects `tts`
   * outright, and `clone` (with an `e`) is not a spelling the parser knows.
   */
  task: string;
  /** Chatterbox is offline-only; `streaming` exists for other families. */
  mode?: 'offline' | 'streaming';
};

export type AudioCppBackend = 'cpu' | 'cuda' | 'hip' | 'vulkan' | 'metal';

export type AudioCppRuntimeOptions = {
  /** Absolute path to `audiocpp_server(.exe)`. Phase 2 resolves this from the engine package. */
  binaryPath: string;
  /** Where the generated `server.json` is written. Must be writable. */
  configPath: string;
  models: readonly AudioCppServerModel[];
  /** Defaults to `cpu`; the upstream default is `cuda`, which a CPU build cannot honour. */
  backend?: AudioCppBackend;
  threads?: number;
  /** How long `/health` may stay silent after spawn before the attempt is abandoned. */
  startupTimeoutMs?: number;
  /** Gap between health probes. */
  healthIntervalMs?: number;
  /** Crashes absorbed within {@link restartWindowMs} before the runtime gives up. */
  maxRestarts?: number;
  restartWindowMs?: number;
  /** How long a killed child is given to exit before it is killed harder. */
  shutdownGraceMs?: number;

  spawn?: AudioCppSpawn;
  /** Resolves true once the server answers `/health` with `status: "ok"`. May throw while the port is closed. */
  probeHealth?: (baseUrl: string) => Promise<boolean>;
  writeConfigFile?: (path: string, contents: string) => Promise<void>;
  allocatePort?: () => Promise<number>;
  delay?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type AudioCppRuntimeErrorKind =
  /** `/health` never answered within the bound. */
  | 'startup-timeout'
  /** The process died before it ever became healthy. */
  | 'exited-during-startup'
  /** The process crashed too often, too fast; the runtime has stopped trying. */
  | 'restart-limit'
  /** {@link AudioCppRuntime.shutdown} interrupted a startup that was in flight. */
  | 'shutdown';

export class AudioCppRuntimeError extends Error {
  public readonly kind: AudioCppRuntimeErrorKind;

  public constructor(kind: AudioCppRuntimeErrorKind, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AudioCppRuntimeError';
    this.kind = kind;
  }
}

/** The only address the engine is ever bound to. */
const LOOPBACK_HOST = '127.0.0.1';

const DEFAULTS = {
  backend: 'cpu' as AudioCppBackend,
  threads: 4,
  startupTimeoutMs: 60_000,
  healthIntervalMs: 250,
  maxRestarts: 3,
  restartWindowMs: 60_000,
  shutdownGraceMs: 5_000,
};

/** One spawned server, and everything the supervisor knows about its fate. */
type RunningServer = {
  child: AudioCppChildProcess;
  baseUrl: string;
  /** True once `/health` has answered, which gates the eager restart. */
  ready: boolean;
  /** True once the process has gone, whether we asked for it or not. */
  exited: boolean;
  /** True when *we* killed it, so its exit is not a crash. */
  expected: boolean;
  /** Resolves when the exit listener fires, so shutdown can await a real teardown. */
  whenExited: Promise<void>;
};

export class AudioCppRuntime {
  private readonly options: Required<Omit<AudioCppRuntimeOptions, 'models'>> & {
    models: readonly AudioCppServerModel[];
  };

  /**
   * The in-flight or settled startup.
   *
   * Concurrent callers share it via `??=` — the same dedupe the renderer's
   * auto-read-aloud hook uses — so three simultaneous requests produce one
   * process, not three. Cleared on failure and on an unexpected exit, so the
   * next call starts over instead of handing out a stale promise.
   */
  private starting: Promise<{ baseUrl: string }> | null = null;
  private current: RunningServer | null = null;
  /** Set once the restart budget is spent; cleared only by an explicit shutdown. */
  private failure: AudioCppRuntimeError | null = null;
  /** Timestamps of recent unexpected exits, pruned to the restart window. */
  private crashes: number[] = [];

  public constructor(options: AudioCppRuntimeOptions) {
    this.options = {
      backend: DEFAULTS.backend,
      threads: DEFAULTS.threads,
      startupTimeoutMs: DEFAULTS.startupTimeoutMs,
      healthIntervalMs: DEFAULTS.healthIntervalMs,
      maxRestarts: DEFAULTS.maxRestarts,
      restartWindowMs: DEFAULTS.restartWindowMs,
      shutdownGraceMs: DEFAULTS.shutdownGraceMs,
      spawn: defaultSpawn,
      probeHealth: defaultProbeHealth,
      writeConfigFile: (path, contents) => writeFile(path, contents, 'utf8'),
      allocatePort: allocateLoopbackPort,
      delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      ...options,
    };
  }

  /** True while a server is up and has answered `/health` at least once. */
  public isRunning(): boolean {
    return this.current?.ready === true && !this.current.exited;
  }

  /**
   * Starts the server if it is not already up, and resolves its base URL.
   *
   * Idempotent, and safe to call from several places at once: the first caller
   * does the work and the rest await the same promise.
   *
   * @throws {AudioCppRuntimeError} when startup times out, the process dies
   *   during startup, or the restart budget has already been spent.
   */
  public async ensureRunning(): Promise<{ baseUrl: string }> {
    if (this.failure) throw this.failure;
    const attempt = (this.starting ??= this.start());
    try {
      return await attempt;
    } catch (error) {
      // Only the attempt that failed clears the slot; a later one may already own it.
      if (this.starting === attempt) this.starting = null;
      throw error;
    }
  }

  /**
   * Stops the server and returns the runtime to a clean idle state.
   *
   * Waits for the child to actually go, so app quit does not race a surviving
   * process. Clears any restart-limit failure too: giving up automatically is a
   * safety bound, but an explicit restart request should not be refused.
   */
  public async shutdown(): Promise<void> {
    const entry = this.current;
    this.current = null;
    this.starting = null;
    this.failure = null;
    this.crashes = [];
    if (!entry) return;
    await this.stopChild(entry);
  }

  private async start(): Promise<{ baseUrl: string }> {
    const port = await this.options.allocatePort();
    const baseUrl = `http://${LOOPBACK_HOST}:${port}`;
    await this.options.writeConfigFile(this.options.configPath, this.buildConfig(port));

    const args = [
      '--config',
      this.options.configPath,
      // Passed on the command line as well as in the config so that the binding is
      // obvious in any process listing, and immune to a stale config on disk.
      '--host',
      LOOPBACK_HOST,
      '--port',
      String(port),
      '--backend',
      this.options.backend,
      '--threads',
      String(this.options.threads),
    ];

    const child = this.options.spawn(this.options.binaryPath, args);
    let markExited = (): void => undefined;
    const entry: RunningServer = {
      child,
      baseUrl,
      ready: false,
      exited: false,
      expected: false,
      whenExited: new Promise<void>((resolve) => (markExited = resolve)),
    };
    this.current = entry;
    child.once('exit', () => {
      markExited();
      this.handleExit(entry);
    });

    try {
      await this.waitForHealth(entry);
    } catch (error) {
      await this.stopChild(entry);
      if (this.current === entry) this.current = null;
      throw error;
    }
    entry.ready = true;
    return { baseUrl };
  }

  private async waitForHealth(entry: RunningServer): Promise<void> {
    const deadline = this.options.now() + this.options.startupTimeoutMs;
    for (;;) {
      this.assertStillStarting(entry);
      // A refused connection is the normal state while the process is still
      // binding its socket, so a throwing probe is "not yet", not a failure.
      const healthy = await this.options.probeHealth(entry.baseUrl).catch(() => false);
      // Re-checked after the probe as well: a process that died *during* it should
      // be reported as having died, not as having run out of time.
      this.assertStillStarting(entry);
      if (healthy) return;
      if (this.options.now() >= deadline) {
        throw new AudioCppRuntimeError(
          'startup-timeout',
          `audio.cpp did not answer /health within ${this.options.startupTimeoutMs}ms`
        );
      }
      await this.options.delay(this.options.healthIntervalMs);
    }
  }

  /** Throws if the server we are waiting on has gone, or has been told to. */
  private assertStillStarting(entry: RunningServer): void {
    if (entry.expected) {
      throw new AudioCppRuntimeError('shutdown', 'audio.cpp startup was cancelled by a shutdown');
    }
    if (entry.exited) {
      throw new AudioCppRuntimeError('exited-during-startup', 'audio.cpp exited before it became healthy');
    }
  }

  /**
   * Reacts to the child going away.
   *
   * An expected exit (our own kill) is ignored. An unexpected one spends a slot
   * of the restart budget; once that is gone the runtime latches into
   * {@link failure} and stays down rather than respawning forever. Only a
   * server that had actually become healthy is restarted eagerly — a startup
   * that died mid-poll is already being reported to the caller, who decides
   * whether to try again.
   */
  private handleExit(entry: RunningServer): void {
    entry.exited = true;
    if (entry.expected) return;
    if (this.current === entry) {
      this.current = null;
      this.starting = null;
    }
    if (this.overRestartBudget()) {
      this.failure = new AudioCppRuntimeError(
        'restart-limit',
        `audio.cpp exited unexpectedly more than ${this.options.maxRestarts} times ` +
          `within ${this.options.restartWindowMs}ms; not restarting it again`
      );
      return;
    }
    if (entry.ready) {
      void this.ensureRunning().catch((): void => undefined);
    }
  }

  /** Records this crash and reports whether the budget is now exhausted. */
  private overRestartBudget(): boolean {
    const now = this.options.now();
    this.crashes = this.crashes.filter((at) => now - at < this.options.restartWindowMs);
    this.crashes.push(now);
    return this.crashes.length > this.options.maxRestarts;
  }

  /** Kills a child and waits for it to go, escalating if it lingers. */
  private async stopChild(entry: RunningServer): Promise<void> {
    entry.expected = true;
    if (entry.exited) return;
    entry.child.kill('SIGTERM');
    const lingered = await Promise.race([
      entry.whenExited.then(() => false),
      this.options.delay(this.options.shutdownGraceMs).then(() => true),
    ]);
    if (lingered && !entry.exited) {
      // On Windows this is the same TerminateProcess as above, but on POSIX it is
      // the difference between a clean quit and an orphan.
      entry.child.kill('SIGKILL');
      await entry.whenExited;
    }
  }

  /**
   * Renders the `server.json` the binary insists on.
   *
   * `lazy_load` matters more than it looks: without it the process loads every
   * model's weights inside its constructor, before it ever starts listening, so
   * the health poll would time out on a cold start.
   */
  private buildConfig(port: number): string {
    return JSON.stringify(
      {
        host: LOOPBACK_HOST,
        port,
        backend: this.options.backend,
        threads: this.options.threads,
        lazy_load: true,
        models: this.options.models.map((model) => ({
          id: model.id,
          family: model.family,
          path: model.path,
          task: model.task,
          mode: model.mode ?? 'offline',
        })),
      },
      null,
      2
    );
  }
}

const defaultSpawn: AudioCppSpawn = (binaryPath, args) =>
  spawnChildProcess(binaryPath, [...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

/**
 * Asks the server whether it is up.
 *
 * `status` is a literal `"ok"` upstream — the handler has no other branch — so
 * anything else means we are talking to something that is not this server.
 */
const defaultProbeHealth = async (baseUrl: string): Promise<boolean> => {
  const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) return false;
  const payload: unknown = await response.json();
  return typeof payload === 'object' && payload !== null && (payload as { status?: unknown }).status === 'ok';
};

/**
 * Finds a free loopback port by briefly holding one.
 *
 * Inherently a race — the port is released before the server claims it — but the
 * alternative is worse: `--port 0` binds an ephemeral port the server never
 * reports back, leaving no way to address it.
 */
const allocateLoopbackPort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, LOOPBACK_HOST, () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('could not determine a free loopback port')));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
