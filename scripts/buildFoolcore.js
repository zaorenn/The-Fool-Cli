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

console.log(`[foolcore] building ${profile} for ${process.platform}-${arch}`);
try {
  // Offline on purpose: every dependency is either vendored in `backend/agent`
  // or already in the cargo registry cache. A build that reaches the network
  // here would mean a path dependency has silently gone back to being a git one.
  execFileSync('cargo', ['build', `--${profile}`, '--bin', 'foolcore', '--offline'], {
    cwd: coreDir,
    stdio: 'inherit',
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
