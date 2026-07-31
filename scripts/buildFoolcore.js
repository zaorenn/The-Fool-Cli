/**
 * Build the backend from source and stage it where the app looks for it.
 *
 * This replaces the download step. The backend used to arrive as a release
 * artefact from another organisation's GitHub, which made every build of this
 * app depend on their infrastructure staying up and their artefact staying put.
 * The source now lives in `backend/`, so the binary is produced here.
 *
 * Layout it stages into, which `binaryResolver.ts` reads:
 *   resources/bundled-foolcore/{platform}-{arch}/foolcore[.exe]
 *
 * Environment:
 *  - FOOL_BACKEND_ARCH: target architecture (default: process.arch)
 *  - FOOL_BACKEND_PROFILE: cargo profile (default: release)
 */

const { execFileSync } = require('child_process');
const { copyFileSync, mkdirSync, existsSync, statSync } = require('fs');
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

console.log(`[foolcore] building ${profile} for ${process.platform}-${arch}`);
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

const stageDir = path.join(projectRoot, 'resources', 'bundled-foolcore', `${process.platform}-${arch}`);
mkdirSync(stageDir, { recursive: true });
const staged = path.join(stageDir, binaryName);
copyFileSync(built, staged);

console.log(`[foolcore] staged ${staged} (${(statSync(staged).size / 1048576).toFixed(1)} MB)`);
