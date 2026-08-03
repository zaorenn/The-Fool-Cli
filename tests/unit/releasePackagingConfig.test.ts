import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const projectRoot = resolve(__dirname, '../..');
const windowsGitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
const bashCommand = process.platform === 'win32' && existsSync(windowsGitBash) ? windowsGitBash : 'bash';
const itWithBash = spawnSync(bashCommand, ['--version'], { encoding: 'utf8' }).status === 0 ? it : it.skip;

/**
 * Hand a path to bash in a form bash will not eat.
 *
 * A native Windows path reaches the shell script as an argument, where
 * `mkdir -p "C:\Users\..."` treats every backslash as an escape. They vanish,
 * the path stops being absolute, and bash creates a directory named
 * `C:Users...` inside the working directory - which is the repository.
 */
const toBashPath = (winPath: string): string => winPath.replace(/\\/g, '/');

function readProjectFile(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8');
}

function yamlBlock(content: string, key: string): string {
  const startMatch = content.match(new RegExp(`^${key}:\\s*$`, 'm'));
  if (!startMatch || startMatch.index === undefined) return '';

  const blockStart = startMatch.index + startMatch[0].length;
  const rest = content.slice(blockStart);
  const nextTopLevelKey = rest.search(/^[a-zA-Z][a-zA-Z0-9]*:\s*$/m);
  return nextTopLevelKey === -1 ? rest : rest.slice(0, nextTopLevelKey);
}

describe('release packaging configuration', () => {
  it('uses the checked-in foolcore source builder in every release path', () => {
    const workflow = readProjectFile('.github/workflows/_build-reusable.yml');
    const webCliPacker = readProjectFile('scripts/pack-web-cli.js');

    expect(workflow).toContain('node scripts/buildFoolcore.js');
    expect(workflow).not.toContain('node scripts/prepareFoolcore.js');
    expect(webCliPacker).toContain("'scripts', 'buildFoolcore.js'");
    expect(webCliPacker).not.toContain('prepare-foolcore.js');
  });

  it('keeps mac zip artifacts enabled', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const macBlock = yamlBlock(config, 'mac');

    expect(macBlock).toContain('    - dmg');
    expect(macBlock).toContain('    - zip');
  });

  it('does not build Windows zip artifacts', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const winBlock = yamlBlock(config, 'win');

    expect(winBlock).toContain('    - nsis');
    expect(winBlock).not.toContain('    - zip');
  });

  it('uploads mac zip artifacts without a stale Windows zip glob', () => {
    const workflow = readProjectFile('.github/workflows/_build-reusable.yml');

    expect(workflow).toContain('out/The Fool-*-mac-*.zip');
    expect(workflow).not.toContain('out/The Fool-*-win32-*.zip');
  });

  it('retries mac prepackaged builds with both dmg and zip targets', () => {
    const script = readProjectFile('scripts/build-with-builder.js');

    expect(script).toMatch(/--mac\s+dmg\s+zip\s+--\$\{targetArch\}\s+--prepackaged/);
  });

  itWithBash('fails release asset preparation when a mac zip is missing', () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'fool-release-assets-'));
    const artifactsDir = resolve(tempDir, 'build-artifacts');
    const outputDir = resolve(tempDir, 'release-assets');

    try {
      const env = { ...process.env, MOCK_VERSION: '1.0.0' };
      const createResult = spawnSync(
        bashCommand,
        ['scripts/create-mock-release-artifacts.sh', toBashPath(artifactsDir)],
        {
          cwd: projectRoot,
          env,
          encoding: 'utf8',
        }
      );
      expect(createResult.status).toBe(0);

      rmSync(resolve(artifactsDir, 'macos-build-arm64', 'The Fool-1.0.0-mac-arm64.zip'), { force: true });

      const prepareResult = spawnSync(
        bashCommand,
        ['scripts/prepare-release-assets.sh', toBashPath(artifactsDir), toBashPath(outputDir)],
        {
          cwd: projectRoot,
          env,
          encoding: 'utf8',
        }
      );

      expect(prepareResult.status).not.toBe(0);
      expect(`${prepareResult.stdout}\n${prepareResult.stderr}`).toContain('Missing macOS zip artifact');
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});

/**
 * The name the installer is uploaded under, and the name the updater asks for,
 * have to be the same string.
 *
 * `latest.yml` is written by electron-builder, and it does not copy the file
 * name into it verbatim: spaces become hyphens, because a URL cannot carry one.
 * GitHub, uploading the same file, replaces spaces with dots instead. So an
 * artifact called `The Fool-2.1.43-win-x64.exe` is hosted as
 * `The.Fool-...` while every installed copy asks for `The-Fool-...` and gets a
 * 404 — an update that is published, visible on the releases page, and
 * undownloadable.
 *
 * A name with no space in it cannot be rewritten by either of them.
 */
describe('installer artifact naming', () => {
  const config = readProjectFile('packages/desktop/electron-builder.yml');

  it('never puts a space in an artifact name', () => {
    const names = [...config.matchAll(/^\s*artifactName:\s*(.+)$/gm)].map((match) => match[1].trim());

    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).not.toContain('${productName}');
      expect(name).not.toContain(' ');
    }
  });

  // The display name keeps its space — it is what the user reads in the Start
  // menu and the installer window, and nothing rewrites it on the way there.
  it('leaves the product name itself alone', () => {
    expect(config).toMatch(/^productName:\s*The Fool$/m);
  });
});
