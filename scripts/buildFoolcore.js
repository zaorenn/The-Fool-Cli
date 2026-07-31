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
  statSync,
  writeFileSync,
} = require('fs');
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
    // Offline on purpose: every dependency is either vendored in `backend/agent`
    // or already in the cargo registry cache. A build that reaches the network
    // here would mean a path dependency has silently gone back to being a git one.
    execFileSync('cargo', ['build', `--${profile}`, '--bin', 'foolcore', '--offline'], {
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
if (existsSync(path.join(managedDir, 'manifest.json'))) {
  console.log(`[foolcore] managed-resources already staged (${readdirSync(managedDir).length} entries)`);
} else {
  const source = resolveManagedResourcesSource();
  if (!source) {
    fail(
      `No managed-resources bundle found for ${runtimeKey}. The packaged app needs a Node runtime and the ` +
        `agent CLIs next to the binary, and cargo does not build them. Point FOOL_MANAGED_RESOURCES_DIR at a copy.`
    );
  }
  console.log(`[foolcore] staging managed-resources from ${source}`);
  cpSync(source, managedDir, { recursive: true });
}

// The bundle manifest is what `afterPack.js` reads to confirm the right
// platform and arch were staged, and what the app reports in its install
// diagnostics. It describes a binary compiled here, not a downloaded one.
const workspaceManifest = path.join(coreDir, 'Cargo.toml');
const version = (readFileSync(workspaceManifest, 'utf8').match(/^version\s*=\s*"([^"]+)"/m) || [])[1];

writeFileSync(
  path.join(stageDir, 'manifest.json'),
  `${JSON.stringify(
    {
      platform: process.platform,
      arch,
      version: version ? `v${version}` : 'unknown',
      generatedAt: new Date().toISOString(),
      sourceType: 'build',
      source: { profile, repository: 'backend/core' },
      files: [binaryName, 'managed-resources/'],
    },
    null,
    2
  )}\n`
);

console.log(`[foolcore] wrote ${path.join(stageDir, 'manifest.json')}`);
