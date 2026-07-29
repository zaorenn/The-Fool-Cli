import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBinaryPath } from '@/process/backend/binaryResolver';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn(), readdirSync: vi.fn() }));

const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
const originalBundledDirOverride = process.env.AIONUI_BACKEND_BUNDLED_DIR;

function setResourcesPath(resourcesPath: string | undefined): void {
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resourcesPath });
}

describe('resolveBinaryPath bundled override', () => {
  afterEach(() => {
    vi.clearAllMocks();
    setResourcesPath(originalResourcesPath);
    if (originalBundledDirOverride === undefined) delete process.env.AIONUI_BACKEND_BUNDLED_DIR;
    else process.env.AIONUI_BACKEND_BUNDLED_DIR = originalBundledDirOverride;
  });

  it('allows an explicit bundled directory in a packaged E2E launch', () => {
    const bundledDir = join('C:\\workspace', 'resources', 'bundled-aioncore');
    const runtimeKey = `${process.platform}-${process.arch}`;
    const binaryName = process.platform === 'win32' ? 'aioncore.exe' : 'aioncore';
    const candidate = join(bundledDir, runtimeKey, binaryName);

    process.env.AIONUI_BACKEND_BUNDLED_DIR = bundledDir;
    setResourcesPath('C:\\electron\\resources');
    vi.mocked(existsSync).mockImplementation(
      (path) => path === bundledDir || path === join(bundledDir, runtimeKey) || path === candidate
    );
    vi.mocked(readdirSync).mockReturnValue([] as ReturnType<typeof readdirSync>);

    expect(resolveBinaryPath({ isPackaged: true, isE2ETest: true })).toBe(candidate);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('falls back when an allowed override does not contain the backend binary', () => {
    const bundledDir = join('C:\\workspace', 'resources', 'bundled-aioncore');
    const runtimeKey = `${process.platform}-${process.arch}`;
    const binaryName = process.platform === 'win32' ? 'aioncore.exe' : 'aioncore';
    const packagedCandidate = join('C:\\electron\\resources', 'bundled-aioncore', runtimeKey, binaryName);
    process.env.AIONUI_BACKEND_BUNDLED_DIR = bundledDir;
    setResourcesPath('C:\\electron\\resources');
    vi.mocked(existsSync).mockImplementation((path) => path === packagedCandidate);
    vi.mocked(readdirSync).mockReturnValue([] as ReturnType<typeof readdirSync>);
    expect(resolveBinaryPath({ isPackaged: false, isE2ETest: false })).toBe(packagedCandidate);
  });

  it('suppresses an override in packaged non-E2E launches', () => {
    const bundledDir = join('C:\\workspace', 'resources', 'bundled-aioncore');
    const runtimeKey = `${process.platform}-${process.arch}`;
    const binaryName = process.platform === 'win32' ? 'aioncore.exe' : 'aioncore';
    const overrideCandidate = join(bundledDir, runtimeKey, binaryName);
    const packagedCandidate = join('C:\\electron\\resources', 'bundled-aioncore', runtimeKey, binaryName);
    process.env.AIONUI_BACKEND_BUNDLED_DIR = bundledDir;
    setResourcesPath('C:\\electron\\resources');
    vi.mocked(existsSync).mockImplementation((path) => path === overrideCandidate || path === packagedCandidate);
    vi.mocked(readdirSync).mockReturnValue([] as ReturnType<typeof readdirSync>);
    expect(resolveBinaryPath({ isPackaged: true, isE2ETest: false })).toBe(packagedCandidate);
  });
});
