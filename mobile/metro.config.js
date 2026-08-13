const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

/**
 * Where the desktop keeps the pure functions this project is allowed to share.
 *
 * This used to be `<repo>/src/common`. The repository became a monorepo and the
 * directory moved under `packages/desktop`, but the path here did not follow.
 * A watch folder that does not exist is not a warning: Metro fails to construct
 * its transformer, so `expo export:embed` bundles nothing and the release build
 * dies at `createBundleReleaseJsAndAssets` with an exit code and no explanation.
 */
const SHARED_CODE_CANDIDATES = [
  path.resolve(workspaceRoot, 'packages/desktop/src/common'),
  path.resolve(workspaceRoot, 'src/common'),
];

const sharedCode = SHARED_CODE_CANDIDATES.find((candidate) => fs.existsSync(candidate));

// Share pure functions from the main The Fool project. Building mobile/ on its
// own is still expected to work, so a missing directory is skipped rather than
// watched into a crash.
config.watchFolders = sharedCode ? [sharedCode] : [];

// Resolve node_modules from mobile/ only
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

// Block platform-specific packages that should never resolve in RN
config.resolver.blockList = [
  /src\/common\/storage\.ts$/, // Desktop-only storage bridge
  /src\/common\/slash\//, // Slash command internals
];

// Map path aliases for shared code
config.resolver.extraNodeModules = sharedCode ? { '@common': sharedCode } : {};

module.exports = config;
