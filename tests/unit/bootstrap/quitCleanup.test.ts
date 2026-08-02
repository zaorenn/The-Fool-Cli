/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { installQuitCleanup } from '@/process/startup/quitCleanup';

type BeforeQuitEvent = {
  preventDefault: () => void;
};

const flushMicrotasks = async () => {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
};

describe('installQuitCleanup', () => {
  it('prevents the first quit until cleanup finishes, then requests quit again', async () => {
    const calls: string[] = [];
    let beforeQuitHandler: ((event: BeforeQuitEvent) => void) | undefined;
    let resolveStopBackend: (() => void) | undefined;

    const quitApp = vi.fn(() => calls.push('quit-app'));
    const stopBackend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          calls.push('stop-backend-start');
          resolveStopBackend = resolve;
        })
    );

    installQuitCleanup({
      onBeforeQuit: (handler) => {
        beforeQuitHandler = handler;
      },
      quitApp,
      setIsQuitting: (value) => calls.push(`set-quitting:${value}`),
      markExplicitQuit: () => calls.push('mark-explicit-quit'),
      destroyTray: () => calls.push('destroy-tray'),
      disposeCronResumeListener: () => calls.push('dispose-cron'),
      stopBackend,
      destroyPetWindow: () => calls.push('destroy-pet'),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
    });

    const preventDefault = vi.fn();
    beforeQuitHandler?.({ preventDefault });
    await flushMicrotasks();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(quitApp).not.toHaveBeenCalled();
    expect(calls).toEqual([
      'set-quitting:true',
      'mark-explicit-quit',
      'destroy-tray',
      // The pet goes before anything is waited on — see the wedged-backend
      // case below for why it cannot be left until after.
      'destroy-pet',
      'dispose-cron',
      'stop-backend-start',
    ]);

    resolveStopBackend?.();
    await flushMicrotasks();

    expect(quitApp).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      'set-quitting:true',
      'mark-explicit-quit',
      'destroy-tray',
      'destroy-pet',
      'dispose-cron',
      'stop-backend-start',
      'quit-app',
    ]);
  });

  it('allows the second before-quit after cleanup has completed', async () => {
    let beforeQuitHandler: ((event: BeforeQuitEvent) => void) | undefined;

    installQuitCleanup({
      onBeforeQuit: (handler) => {
        beforeQuitHandler = handler;
      },
      quitApp: vi.fn(),
      setIsQuitting: vi.fn(),
      markExplicitQuit: vi.fn(),
      destroyTray: vi.fn(),
      disposeCronResumeListener: vi.fn(),
      stopBackend: async () => {},
      destroyPetWindow: vi.fn(),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
    });

    beforeQuitHandler?.({ preventDefault: vi.fn() });
    await flushMicrotasks();

    const preventDefault = vi.fn();
    beforeQuitHandler?.({ preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
  });
});

/**
 * The pet is the app's most visible surface: two frameless always-on-top
 * windows that sit over everything. If the app is quitting, it has to go, and
 * it going is how the user knows the quit took.
 *
 * It used to be destroyed after the backend was stopped, and behind the same
 * ten-second timeout. A backend that would not stop — a model still loading, a
 * synthesis in flight, a child process holding a file — spent that whole budget
 * and the pet was never reached: the tray menu said Quit, the window went, and
 * the jester stayed on screen looking like the app had ignored the request.
 *
 * Destroying it first costs nothing: it is synchronous and local.
 */
describe('installQuitCleanup when the backend will not stop', () => {
  it('still takes the pet off the screen', async () => {
    const calls: string[] = [];
    let beforeQuitHandler: ((event: { preventDefault: () => void }) => void) | undefined;

    installQuitCleanup({
      onBeforeQuit: (handler) => {
        beforeQuitHandler = handler;
      },
      quitApp: () => calls.push('quit-app'),
      setIsQuitting: () => undefined,
      markExplicitQuit: () => undefined,
      destroyTray: () => calls.push('destroy-tray'),
      disposeCronResumeListener: () => undefined,
      // Never resolves, exactly like a backend that has wedged.
      stopBackend: () => new Promise<void>(() => undefined),
      destroyPetWindow: () => calls.push('destroy-pet'),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
      timeoutMs: 20,
    });

    beforeQuitHandler?.({ preventDefault: vi.fn() });
    await flushMicrotasks();

    // Gone before anything is waited on, not after.
    expect(calls).toContain('destroy-pet');

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls).toContain('quit-app');
  });

  it('destroys the pet before it starts waiting on the backend', async () => {
    const calls: string[] = [];
    let beforeQuitHandler: ((event: { preventDefault: () => void }) => void) | undefined;

    installQuitCleanup({
      onBeforeQuit: (handler) => {
        beforeQuitHandler = handler;
      },
      quitApp: () => calls.push('quit-app'),
      setIsQuitting: () => undefined,
      markExplicitQuit: () => undefined,
      destroyTray: () => calls.push('destroy-tray'),
      disposeCronResumeListener: () => undefined,
      stopBackend: async () => {
        calls.push('stop-backend');
      },
      destroyPetWindow: () => calls.push('destroy-pet'),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
      timeoutMs: 500,
    });

    beforeQuitHandler?.({ preventDefault: vi.fn() });
    await flushMicrotasks();

    expect(calls.indexOf('destroy-pet')).toBeLessThan(calls.indexOf('stop-backend'));
  });
});
