/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Telling somebody which model their computer can actually run.
 *
 * `adviseLocalModel` could answer this from the day it was written and nothing
 * ever called it, because nothing measured the machine. "Load a model" was the
 * entire instruction the setup panel gave, in front of a catalogue of thousands
 * of files — which is where local-first quietly fails.
 *
 * These cover the measurement, which is the half that was missing: what it
 * reads, and what it says when it cannot read anything. The advice itself has
 * its own tests; what is asserted here is that the two halves agree about a real
 * machine.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { adviseLocalModel } from '@/common/config/localModelAdvice';

const loadModule = async () => {
  vi.resetModules();
  return import('@process/services/local-models/machineMemory');
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('reading the graphics card', () => {
  it('answers null off Windows rather than shelling out for nothing', async () => {
    const { readVramGb } = await loadModule();

    expect(await readVramGb('darwin')).toBeNull();
    expect(await readVramGb('linux')).toBeNull();
  });
});

describe('the whole machine', () => {
  it('reports system memory in whole gigabytes', async () => {
    vi.doMock('node:os', () => ({ totalmem: () => 32 * 1024 ** 3 }));
    const { readMachineMemory, forgetMachineMemory } = await loadModule();
    forgetMachineMemory();

    expect((await readMachineMemory()).ramGb).toBe(32);
    vi.doUnmock('node:os');
  });

  it('measures once, because neither figure changes while the app runs', async () => {
    const totalmem = vi.fn(() => 16 * 1024 ** 3);
    vi.doMock('node:os', () => ({ totalmem }));
    const { readMachineMemory, forgetMachineMemory } = await loadModule();
    forgetMachineMemory();

    await readMachineMemory();
    await readMachineMemory();
    await readMachineMemory();

    expect(totalmem).toHaveBeenCalledTimes(1);
    vi.doUnmock('node:os');
  });
});

/**
 * The two halves against machines somebody actually owns.
 *
 * Written as the reading the measurement produces rather than as the advice's
 * own input type, so a change to either side that stops them lining up fails
 * here rather than in a panel nobody is looking at.
 */
describe('what a real machine is told', () => {
  it('recommends a 12–14B for a 16 GB card, not something two sizes down', () => {
    // 16 GB reported as 15 after flooring, which is what the registry gives:
    // some of the card is already spoken for.
    const advice = adviseLocalModel({ vramGb: 15, ramGb: 64 });

    expect(advice.recommended?.parameters).toBe('12–14B');
    expect(advice.reason).toBe('gpu');
    expect(advice.onCpu).toBe(false);
  });

  it('falls back to system memory when the card cannot be read, and says so', () => {
    const advice = adviseLocalModel({ vramGb: null, ramGb: 32 });

    expect(advice.recommended).not.toBeNull();
    expect(advice.reason).toBe('unknown');
    expect(advice.onCpu).toBe(true);
  });

  it('refuses to recommend anything to a machine with no room', () => {
    const advice = adviseLocalModel({ vramGb: null, ramGb: 4 });

    expect(advice.recommended).toBeNull();
    expect(advice.reason).toBe('too-small');
  });

  it('answers a failed measurement the same way as a small machine', () => {
    // What the bridge returns when the main process cannot describe itself.
    const advice = adviseLocalModel({ vramGb: null, ramGb: 0 });

    expect(advice.recommended).toBeNull();
    expect(advice.reason).toBe('too-small');
  });

  it('has a translation key for every reason it can give', () => {
    const reasons = new Set(
      [
        adviseLocalModel({ vramGb: 15, ramGb: 64 }),
        adviseLocalModel({ vramGb: null, ramGb: 32 }),
        adviseLocalModel({ vramGb: 3, ramGb: 32 }),
        adviseLocalModel({ vramGb: null, ramGb: 2 }),
      ].map((advice) => advice.reason)
    );

    // `too-small` is the one the panel answers with its own line rather than a
    // recommendation; the other three interpolate a size.
    expect([...reasons].toSorted()).toEqual(['gpu', 'no-gpu', 'too-small', 'unknown']);
  });
});
