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

/** `*` matches anything but a separator; everything else is literal. */
function matchesGlob(glob: string, candidate: string): boolean {
  const pattern = glob
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${pattern}$`).test(candidate);
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

    expect(workflow).toContain('out/*-mac-*.zip');
    expect(workflow).not.toContain('out/The Fool-*-win32-*.zip');
  });

  /**
   * The glob that uploads the macOS zips, and the name electron-builder gives
   * them, are two strings in two files that have to agree. They did not: the
   * workflow globbed `out/The Fool-*-mac-*.zip` while `artifactName` had been
   * changed to `TheFool-...` to keep spaces out of the update feed. The glob
   * matched nothing, the zips were never uploaded, and the release job — which
   * had never once been reached — would have failed looking for them.
   *
   * So assert the agreement rather than either string on its own.
   */
  it('uploads artifacts under the names electron-builder actually writes', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const workflow = readProjectFile('.github/workflows/_build-reusable.yml');

    const macArtifactName = yamlBlock(config, 'mac')
      .match(/^\s*artifactName:\s*(.+)$/m)?.[1]
      .trim();
    expect(macArtifactName).toBeDefined();

    const macZip = macArtifactName!
      .replace('${version}', '9.9.9')
      .replace('${os}', 'mac')
      .replace('${arch}', 'x64')
      .replace('${ext}', 'zip');

    const uploadGlobs = [...workflow.matchAll(/^\s{10,}(out\/\S.*)$/gm)].map((match) => match[1].trim());
    const zipGlobs = uploadGlobs.filter((glob) => glob.endsWith('.zip'));

    expect(zipGlobs.length).toBeGreaterThan(0);
    expect(zipGlobs.some((glob) => matchesGlob(glob, `out/${macZip}`))).toBe(true);
  });

  /**
   * The same disagreement, one file further along: the release scripts spelled
   * every distributable `The Fool-...`. `prepare-release-assets.sh` therefore
   * declared a complete build incomplete, and `verify-release-assets.sh` — where
   * the list was also unquoted — split on the space and checked for a file
   * called `The`.
   */
  it('never spells a distributable with a space in the release scripts', () => {
    for (const script of [
      'scripts/prepare-release-assets.sh',
      'scripts/verify-release-assets.sh',
      'scripts/create-mock-release-artifacts.sh',
      // Not a CI script: this one builds the URL a Linux user downloads from,
      // and the space made it a 404 they would have hit before we did.
      'scripts/install-ubuntu.sh',
    ]) {
      const body = readProjectFile(script)
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n');

      expect(body, `${script} still refers to a spaced artifact name`).not.toContain('The Fool-');
    }
  });

  /**
   * A build that failed on one platform still leaves the others to publish. A
   * build that was *skipped* leaves nothing — and the first attempt at this gate
   * said "not cancelled", which let a skipped pipeline through: the quality job
   * failed on a transient network error, every build was skipped, and the
   * release job ran against an empty directory.
   */
  it('releases from a partial build but not from an absent one', () => {
    const workflow = readProjectFile('.github/workflows/build-and-release.yml');
    const releaseIf = workflow.match(/^ {4}if: always\(\) && contains.*$/m)?.[0];

    expect(releaseIf, 'the release job gate should be an allow-list of results').toBeDefined();

    for (const job of ['build-pipeline', 'pack-web-cli']) {
      expect(releaseIf).toContain(`needs.${job}.result`);
    }
    expect(releaseIf).toContain(`fromJSON('["success", "failure"]')`);
    expect(releaseIf, 'a skipped build must not be treated as releasable').not.toContain("!= 'cancelled'");
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

      rmSync(resolve(artifactsDir, 'macos-build-arm64', 'TheFool-1.0.0-mac-arm64.zip'), { force: true });

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
      expect(`${prepareResult.stdout}\n${prepareResult.stderr}`).toContain('macOS arm64 built but its zip is missing');
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  /**
   * A platform that did not build leaves nothing behind, and that is not a
   * reason to withhold the platforms that did. Requiring all six is how the
   * project reached 2.5.2 with the Windows installers sitting in the artifacts
   * of every failed run.
   */
  itWithBash('prepares a Windows-only release when no other platform built', () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'fool-release-partial-'));
    const artifactsDir = resolve(tempDir, 'build-artifacts');
    const outputDir = resolve(tempDir, 'release-assets');

    try {
      const env = { ...process.env, MOCK_VERSION: '1.0.0' };
      expect(
        spawnSync(bashCommand, ['scripts/create-mock-release-artifacts.sh', toBashPath(artifactsDir)], {
          cwd: projectRoot,
          env,
          encoding: 'utf8',
        }).status
      ).toBe(0);

      for (const gone of [
        'macos-build-x64',
        'macos-build-arm64',
        'linux-build-x64',
        'linux-build-arm64',
        'web-cli-darwin-arm64',
        'web-cli-darwin-x86_64',
        'web-cli-linux-arm64',
        'web-cli-linux-x86_64',
        'web-cli-win-x86_64',
        'install-web-script',
      ]) {
        rmSync(resolve(artifactsDir, gone), { force: true, recursive: true });
      }

      const prepareResult = spawnSync(
        bashCommand,
        ['scripts/prepare-release-assets.sh', toBashPath(artifactsDir), toBashPath(outputDir)],
        { cwd: projectRoot, env, encoding: 'utf8' }
      );

      const output = `${prepareResult.stdout}\n${prepareResult.stderr}`;
      expect(prepareResult.status, output).toBe(0);
      expect(output).toContain('Partial release');
      expect(existsSync(resolve(outputDir, 'latest.yml'))).toBe(true);
      expect(existsSync(resolve(outputDir, 'TheFool-1.0.0-win-x64.exe'))).toBe(true);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  itWithBash('still refuses to prepare a release with no Windows installer', () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'fool-release-nowin-'));
    const artifactsDir = resolve(tempDir, 'build-artifacts');
    const outputDir = resolve(tempDir, 'release-assets');

    try {
      const env = { ...process.env, MOCK_VERSION: '1.0.0' };
      spawnSync(bashCommand, ['scripts/create-mock-release-artifacts.sh', toBashPath(artifactsDir)], {
        cwd: projectRoot,
        env,
        encoding: 'utf8',
      });
      rmSync(resolve(artifactsDir, 'windows-build-x64'), { force: true, recursive: true });
      rmSync(resolve(artifactsDir, 'windows-build-arm64'), { force: true, recursive: true });

      const prepareResult = spawnSync(
        bashCommand,
        ['scripts/prepare-release-assets.sh', toBashPath(artifactsDir), toBashPath(outputDir)],
        { cwd: projectRoot, env, encoding: 'utf8' }
      );

      expect(prepareResult.status).not.toBe(0);
      expect(`${prepareResult.stdout}\n${prepareResult.stderr}`).toContain('No Windows installer');
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
