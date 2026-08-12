/**
 * Build the backend from source and stage it where the app looks for it.
 *
 * This replaces the download step. The backend used to arrive as a release
 * artefact from another organisation's GitHub, which made every build of this
 * app depend on their infrastructure staying up and their artefact staying put.
 * The source now lives in `backend/`, so the binary is produced here.
 *
 * Layout it stages into, which `binaryResolver.ts` reads and `afterPack.js`
 * verifies before electron-builder is allowed to produce an installer:
 *   resources/bundled-foolcore/{platform}-{arch}/foolcore[.exe]
 *   resources/bundled-foolcore/{platform}-{arch}/manifest.json
 *   resources/bundled-foolcore/{platform}-{arch}/managed-resources/
 *
 * Only the first of those three comes out of cargo. `managed-resources` is a
 * Node runtime plus the agent CLIs — third-party binaries the release zip used
 * to carry alongside the backend. Compiling the backend here did not remove the
 * app's need for them, so they are staged from an existing bundle rather than
 * rebuilt.
 *
 * The version it produces is declared in the root `package.json` as
 * `foolcoreVersion` and asserted against `backend/core/Cargo.toml` before
 * anything is compiled — see below for why that is worth a failed build.
 *
 * Environment:
 *  - FOOL_BACKEND_ARCH: target architecture (default: process.arch)
 *  - FOOL_BACKEND_PROFILE: cargo profile (default: release)
 *  - FOOL_MANAGED_RESOURCES_DIR: where to copy `managed-resources` from
 *  - FOOL_BACKEND_SKIP_COMPILE: reuse the staged binary, only redo the staging
 */

const { execFileSync } = require('child_process');
const {
  copyFileSync,
  cpSync,
  mkdirSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('fs');
const { homedir, userInfo } = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const coreDir = path.join(projectRoot, 'backend', 'core');
const binaryName = process.platform === 'win32' ? 'foolcore.exe' : 'foolcore';
const arch = process.env.FOOL_BACKEND_ARCH || process.arch;
const profile = process.env.FOOL_BACKEND_PROFILE || 'release';

function fail(message) {
  console.error(`[foolcore] ${message}`);
  process.exit(1);
}

if (!existsSync(path.join(coreDir, 'Cargo.toml'))) {
  fail(`No backend source at ${coreDir}. Expected the workspace manifest there.`);
}

/**
 * The version this app expects its backend to be, and the check that it is.
 *
 * The backend lives in this repository rather than arriving as a release from
 * another one, which is deliberate — a build here should not depend on somebody
 * else's infrastructure staying up. What it cost was the backend's identity:
 * two builds of two very different trees both called themselves `v0.1.54`,
 * because nothing but `backend/core/Cargo.toml` ever said otherwise, and CI
 * carried a comment claiming a `foolcoreVersion` pin in `package.json` that did
 * not exist.
 *
 * So the version is declared in one place a person reads — the root
 * `package.json`, the way `aioncoreVersion` is declared upstream — and this
 * refuses to build a backend that disagrees with it. Bumping the workspace
 * without bumping the declaration is then a failed build rather than a silent
 * mislabelling of every installer produced afterwards.
 */
const declaredBackendVersion = (() => {
  const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  return typeof pkg.foolcoreVersion === 'string' ? pkg.foolcoreVersion : null;
})();

const workspaceVersion = (() => {
  const source = readFileSync(path.join(coreDir, 'Cargo.toml'), 'utf8');
  const found = source.match(/^version\s*=\s*"([^"]+)"/m);
  return found ? `v${found[1]}` : null;
})();

if (!declaredBackendVersion) {
  fail('package.json has no `foolcoreVersion`. It declares which backend this app ships with.');
}
if (!workspaceVersion) {
  fail(`Could not read a version from ${path.join(coreDir, 'Cargo.toml')}.`);
}
if (declaredBackendVersion !== workspaceVersion) {
  fail(
    `Backend version disagreement: package.json says ${declaredBackendVersion}, ` +
      `backend/core/Cargo.toml says ${workspaceVersion}. Bump both, or neither.`
  );
}

/**
 * Which commit of the backend this is.
 *
 * The declared version answers "which backend", and stays put for months; this
 * answers "which build of it", and is the only thing that separates two
 * binaries that both call themselves the same version. Taken from the last
 * commit that touched `backend/`, not from HEAD, so a run of renderer commits
 * does not keep restamping an unchanged binary as something new.
 *
 * Best effort: a source archive with no git history still builds, it just
 * cannot say which commit it came from.
 */
const backendCommit = (() => {
  try {
    return (
      execFileSync('git', ['log', '-1', '--format=%h', '--', 'backend'], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .trim()
        .slice(0, 12) || null
    );
  } catch {
    return null;
  }
})();

/**
 * Link the MSVC runtime into the binary on Windows.
 *
 * Without this, foolcore.exe imports VCRUNTIME140.dll, which a freshly
 * installed Windows does not have — it arrives with the Visual C++
 * Redistributable. The app would install cleanly and then fail to start its
 * backend on exactly the machines a first-time user has.
 *
 * This belongs here rather than in `.cargo/config.toml`: applied there it also
 * hits `cargo test`, where the test harness pulls in proc-macro and dylib
 * crates that cannot link against a static CRT ("crate ... required to be
 * available in rlib format").
 */
const buildEnv = { ...process.env };
if (process.platform === 'win32') {
  buildEnv.RUSTFLAGS = [buildEnv.RUSTFLAGS, '-C target-feature=+crt-static'].filter(Boolean).join(' ');
}

/**
 * Keep the machine that built it out of the binary.
 *
 * `file!()` bakes an absolute source path into every panic message and every
 * `#[track_caller]` site, and the paths are not only this repository's — most of
 * them point into the Cargo registry under the builder's home directory. A
 * release build measured before this went in carried the account name of the
 * machine that produced it 4,684 times. Nothing reads those paths at runtime;
 * they are shipped to tens of thousands of installs for no purpose, and they say
 * who made the build and where they keep their files.
 *
 * Remapped rather than stripped, so a panic still names the file it came from —
 * `/src/crates/fool-app/src/main.rs` locates the code exactly as well as the
 * absolute path did, and tells nobody anything about the machine.
 */
const anonymisedPaths = [
  ['--remap-path-prefix', `${homedir()}=/build`],
  ['--remap-path-prefix', `${projectRoot}=/src`],
]
  .map(([flag, value]) => `${flag}=${value}`)
  .join(' ');
buildEnv.RUSTFLAGS = [buildEnv.RUSTFLAGS, anonymisedPaths].filter(Boolean).join(' ');

/**
 * Remove the build account's name from the staged binary.
 *
 * The remapping above deals with the compiler's own record of where the source
 * was — 4,684 references down to 84 on the build that measured it. The last few
 * do not come from source paths at all: a dependency that writes
 * `env!("CARGO_MANIFEST_DIR")` into a string is reading an environment variable,
 * and no compiler flag rewrites that. For a crate in the registry, that variable
 * holds the builder's home directory.
 *
 * So the remainder is taken out of the bytes. The name is replaced with the same
 * number of `x` characters, which keeps every offset in the file exactly where
 * it was — the alternative, shortening a string inside a linked executable,
 * would move everything after it. What is left reads
 * `C:\Users\xxxxxx\.cargo\registry\…`: still a path, still useless to anyone,
 * and no longer anybody's name.
 *
 * These strings are never opened. They exist to be printed in a panic message,
 * and a panic that names `/build/…` locates the code just as well.
 */
function scrubBuildUser(binaryPath) {
  const name = userInfo().username;
  // A one or two character account name would match arbitrary byte sequences
  // all over an 88 MB executable. Nothing is worth corrupting a binary over.
  if (name.length < 3) return 0;

  const contents = readFileSync(binaryPath);
  const needle = Buffer.from(`\\${name}\\`, 'latin1');
  const replacement = Buffer.from(`\\${'x'.repeat(name.length)}\\`, 'latin1');

  let found = 0;
  let at = contents.indexOf(needle);
  while (at !== -1) {
    replacement.copy(contents, at);
    found += 1;
    at = contents.indexOf(needle, at + needle.length);
  }

  if (found > 0) writeFileSync(binaryPath, contents);
  return found;
}

const runtimeKey = `${process.platform}-${arch}`;
const stageDir = path.join(projectRoot, 'resources', 'bundled-foolcore', runtimeKey);
const staged = path.join(stageDir, binaryName);
const skipCompile = process.env.FOOL_BACKEND_SKIP_COMPILE === '1';

if (skipCompile) {
  if (!existsSync(staged)) fail(`FOOL_BACKEND_SKIP_COMPILE is set but ${staged} is not there.`);
  console.log(`[foolcore] reusing ${staged}`);
} else {
  console.log(`[foolcore] building ${profile} for ${runtimeKey}`);
  try {
    // The lockfile makes release builds reproducible while still allowing a
    // clean CI runner to populate its Cargo registry cache.
    execFileSync('cargo', ['build', `--${profile}`, '--bin', 'foolcore', '--locked'], {
      cwd: coreDir,
      stdio: 'inherit',
      env: buildEnv,
    });
  } catch {
    fail('cargo build failed. Run it inside backend/core to see the full output.');
  }

  const built = path.join(coreDir, 'target', profile, binaryName);
  if (!existsSync(built)) fail(`cargo reported success but ${built} is not there.`);

  mkdirSync(stageDir, { recursive: true });
  copyFileSync(built, staged);
  console.log(`[foolcore] staged ${staged} (${(statSync(staged).size / 1048576).toFixed(1)} MB)`);
}

// Both paths, not only the one that compiled. A binary staged by some other
// means has never been through this, and a privacy guarantee that depends on
// which branch ran is not one.
console.log(`[foolcore] scrubbed ${scrubBuildUser(staged)} references to the build account`);

/**
 * Find a `managed-resources` tree to stage.
 *
 * Cargo cannot produce this one: it is a Node runtime and the agent CLIs, which
 * the backend release zip used to carry. Preference order is an explicit
 * override, then the upstream bundle this fork was cut from, then an installed
 * copy of the app on this machine.
 *
 * Only reached when nothing is staged yet — see the caller below — so the
 * already-staged tree is deliberately not a candidate here.
 */
function resolveManagedResourcesSource() {
  const candidates = [
    process.env.FOOL_MANAGED_RESOURCES_DIR,
    path.join(projectRoot, 'resources', 'bundled-upstream', runtimeKey, 'managed-resources'),
    process.env.LOCALAPPDATA &&
      path.join(
        process.env.LOCALAPPDATA,
        'Programs',
        'The Fool',
        'resources',
        'bundled-foolcore',
        runtimeKey,
        'managed-resources'
      ),
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(path.join(candidate, 'manifest.json')));
}

const managedDir = path.join(stageDir, 'managed-resources');

function prepareManagedResources() {
  const dataDir = path.join(stageDir, '.prepare-data');
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(managedDir, { recursive: true, force: true });
  mkdirSync(managedDir, { recursive: true });

  try {
    execFileSync(staged, ['--data-dir', dataDir, 'prepare-managed-resources', '--bundle-out', managedDir], {
      stdio: 'inherit',
      env: { ...process.env, FOOL_BUNDLED_MANAGED_RESOURCES: '' },
    });
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}
if (existsSync(path.join(managedDir, 'manifest.json'))) {
  console.log(`[foolcore] managed-resources already staged (${readdirSync(managedDir).length} entries)`);
} else {
  const source = resolveManagedResourcesSource();
  if (source) {
    console.log(`[foolcore] staging managed-resources from ${source}`);
    cpSync(source, managedDir, { recursive: true });
  } else if (process.env.CI) {
    console.log(`[foolcore] preparing managed-resources for clean CI runner ${runtimeKey}`);
    try {
      prepareManagedResources();
    } catch {
      fail(`failed to prepare managed-resources for ${runtimeKey}`);
    }
  } else {
    // Not fatal, because it is not fatal for `bun run dev`.
    //
    // This tree is a Node runtime and the agent CLIs. It is not in the
    // repository and cargo cannot build it, so a fresh source clone has no way
    // to produce one — and this step used to stop there, which meant nobody
    // could get from a source download to a running app. The backend defaults
    // to `ManagedResourcesMode::Download` and fetches what it needs at runtime,
    // so a dev run is fine without it.
    //
    // Packaging is a different question and stays gated: `afterPack.js` runs
    // `verifyBundledFoolcoreResources`, which refuses to produce an installer
    // with this directory missing. So the warning cannot become a shipped
    // installer that fails on the user's machine.
    console.warn(
      `[foolcore] no managed-resources bundle for ${runtimeKey}; staging the binary alone.\n` +
        `[foolcore] Fine for development — the backend downloads the Node runtime and agent CLIs it needs.\n` +
        `[foolcore] Building an installer needs the bundle: point FOOL_MANAGED_RESOURCES_DIR at a copy, or\n` +
        `[foolcore] install a release of the app first and it will be found automatically.`
    );
  }
}

// The bundle manifest is what `afterPack.js` reads to confirm the right
// platform and arch were staged, and what the app reports in its install
// diagnostics. It describes a binary compiled here, not a downloaded one.
writeFileSync(
  path.join(stageDir, 'manifest.json'),
  `${JSON.stringify(
    {
      platform: process.platform,
      arch,
      version: workspaceVersion,
      // Which build of that version. Without it, every binary this repository
      // has ever produced reports the same string, and a bug report naming a
      // version names several months of them.
      commit: backendCommit,
      generatedAt: new Date().toISOString(),
      sourceType: 'build',
      source: { profile, repository: 'backend/core' },
      // What was actually staged, not what a complete bundle contains. A
      // manifest that lists a directory it does not have sends the install
      // diagnostics looking for a fault somewhere else.
      files: existsSync(managedDir) ? [binaryName, 'managed-resources/'] : [binaryName],
    },
    null,
    2
  )}\n`
);

console.log(`[foolcore] wrote ${path.join(stageDir, 'manifest.json')}`);
