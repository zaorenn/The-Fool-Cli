/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { totalmem } from 'node:os';
import { execFile } from 'node:child_process';

/**
 * How much memory this machine can give a local model.
 *
 * `localModelAdvice` has been able to answer "which model fits here" since it
 * was written, and nothing ever told it what "here" was. This is the missing
 * half: it measures, badly and honestly, and says `null` rather than a guess
 * when it cannot.
 *
 * **Graphics memory is genuinely hard to read.** Electron's `getGPUInfo` does
 * not report it on any platform. `Win32_VideoController.AdapterRAM` does, in a
 * 32-bit field, so every card above 4 GB reports exactly 4 GB — which is worse
 * than no answer, because it silently recommends an 8B to a machine that could
 * run a 32B. The driver writes the real figure to the registry as a 64-bit
 * value, and that is what this reads.
 *
 * Everywhere else answers `null`, which is the truth and is also survivable:
 * the advice falls back to a conservative share of system memory, and on Apple
 * silicon that fallback is the correct calculation anyway, because the memory
 * really is shared.
 */

/** Windows' display adapter class, where every card's key lives. */
const DISPLAY_CLASS = '{4d36e968-e325-11ce-bfc1-08002be10318}';

/**
 * Long enough for a registry read on a cold machine, short enough that setup
 * never waits on it. A timeout is answered the same way as an unreadable card.
 */
const PROBE_TIMEOUT_MS = 4_000;

const BYTES_PER_GB = 1024 ** 3;

/**
 * The largest `qwMemorySize` among the installed adapters, in bytes.
 *
 * Largest rather than first: a laptop reports its integrated adapter alongside
 * the discrete one, usually in that order, and recommending a model sized for
 * the integrated chip on a machine with a real card is the exact failure this
 * exists to prevent.
 */
const readWindowsVramScript = `
$ErrorActionPreference = 'SilentlyContinue'
$root = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\${DISPLAY_CLASS}'
$sizes = Get-ChildItem $root |
  ForEach-Object { (Get-ItemProperty $_.PSPath).'HardwareInformation.qwMemorySize' } |
  Where-Object { $_ -is [long] -or $_ -is [int] }
if ($sizes) { [int64](($sizes | Measure-Object -Maximum).Maximum) } else { 0 }
`;

const runPowerShell = (script: string): Promise<string> =>
  new Promise((resolve) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => resolve(error ? '' : stdout)
    );
    // A machine without PowerShell is not an error worth raising anywhere.
    child.on('error', () => resolve(''));
  });

/** Graphics memory in whole gigabytes, or null when it could not be read. */
export const readVramGb = async (platform: string = process.platform): Promise<number | null> => {
  if (platform !== 'win32') return null;

  const bytes = Number.parseInt((await runPowerShell(readWindowsVramScript)).trim(), 10);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;

  const gigabytes = Math.floor(bytes / BYTES_PER_GB);
  return gigabytes > 0 ? gigabytes : null;
};

export type MachineMemoryReading = {
  vramGb: number | null;
  ramGb: number;
};

/**
 * What the advice needs, measured once.
 *
 * Cached for the process: neither figure changes while the app is running, and
 * the setup panel is re-opened often enough that spawning a shell each time
 * would be felt.
 */
let cached: MachineMemoryReading | null = null;

/**
 * Whether an answer is worth keeping.
 *
 * A reading with no graphics figure on Windows is the one that might have been
 * different: the shell can time out on a busy machine, and caching that turns a
 * momentary failure into a permanently worse recommendation — the panel would
 * go on saying "this is a careful guess" about a card it could have measured.
 * Everywhere else `null` is the final answer, so it is kept.
 */
const worthKeeping = (reading: MachineMemoryReading, platform: string): boolean =>
  reading.vramGb !== null || platform !== 'win32';

export const readMachineMemory = async (): Promise<MachineMemoryReading> => {
  if (cached) return cached;

  const reading: MachineMemoryReading = {
    vramGb: await readVramGb(),
    // Floored, because a machine that reports 15.9 has 15.
    ramGb: Math.floor(totalmem() / BYTES_PER_GB),
  };
  if (worthKeeping(reading, process.platform)) cached = reading;
  return reading;
};

/** Forgets the measurement, for a test that wants a clean module. */
export const forgetMachineMemory = (): void => {
  cached = null;
};
