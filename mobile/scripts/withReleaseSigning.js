/**
 * Config plugin that wires a persistent release keystore into the generated
 * Android project.
 *
 * `expo prebuild` regenerates `android/app/build.gradle` from the template every
 * time, and that template signs the release build type with the shared debug
 * keystore. Two APKs built that way carry different signatures once anything
 * about the debug keystore changes, and Android refuses to install one over the
 * other. Editing the generated file by hand does not survive the next prebuild,
 * so the substitution has to happen during prebuild itself.
 *
 * The signing material is read from the environment so that no key or password
 * ever enters the repository:
 *
 *   FOOL_ANDROID_KEYSTORE           absolute path to the .jks file
 *   FOOL_ANDROID_KEYSTORE_PASSWORD  store password
 *   FOOL_ANDROID_KEY_ALIAS          key alias
 *   FOOL_ANDROID_KEY_PASSWORD       key password
 *
 * When FOOL_ANDROID_KEYSTORE is not set the plugin does nothing and the project
 * keeps the stock debug signing, so `expo run:android` is unaffected.
 */

const { withAppBuildGradle } = require('@expo/config-plugins');

const DEBUG_SIGNING_CONFIG = 'signingConfig signingConfigs.debug';
const RELEASE_SIGNING_CONFIG = 'signingConfig signingConfigs.release';

/**
 * Replaces the release build type's signing config without touching the debug
 * one. Both build types contain the same statement, so the search starts at the
 * release block rather than at the top of the file.
 *
 * `expo prebuild` without `--clean` reuses the existing android directory and
 * runs the mods over a file this plugin already edited, so an already-correct
 * file has to read as success rather than as a missing statement.
 */
function pointReleaseAtReleaseKey(contents) {
  const buildTypesIndex = contents.indexOf('buildTypes {');
  if (buildTypesIndex === -1) return null;

  const releaseIndex = contents.indexOf('release {', buildTypesIndex);
  if (releaseIndex === -1) return null;

  const debugIndex = contents.indexOf(DEBUG_SIGNING_CONFIG, releaseIndex);
  const releaseStatementIndex = contents.indexOf(RELEASE_SIGNING_CONFIG, releaseIndex);

  const alreadyPointed =
    releaseStatementIndex !== -1 && (debugIndex === -1 || releaseStatementIndex < debugIndex);
  if (alreadyPointed) return contents;

  if (debugIndex === -1) return null;

  return (
    contents.slice(0, debugIndex) +
    RELEASE_SIGNING_CONFIG +
    contents.slice(debugIndex + DEBUG_SIGNING_CONFIG.length)
  );
}

/** Returns the index just past the `}` that closes a block opened at openIndex. */
function endOfBlock(contents, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < contents.length; i += 1) {
    if (contents[i] === '{') depth += 1;
    else if (contents[i] === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Writes the `release` entry into signingConfigs, replacing an entry a previous
 * prebuild left behind. Rewriting rather than skipping matters because a reused
 * android directory would otherwise keep signing with a stale path or password.
 */
function addReleaseSigningConfig(contents, signing) {
  const anchor = 'signingConfigs {';
  const anchorIndex = contents.indexOf(anchor);
  if (anchorIndex === -1) return null;

  const block = [
    '',
    '        release {',
    `            storeFile file('${signing.storeFile}')`,
    `            storePassword '${signing.storePassword}'`,
    `            keyAlias '${signing.keyAlias}'`,
    `            keyPassword '${signing.keyPassword}'`,
    '        }',
  ].join('\n');

  const buildTypesIndex = contents.indexOf('buildTypes {', anchorIndex);
  const regionEnd = buildTypesIndex === -1 ? contents.length : buildTypesIndex;
  const existing = /\brelease\s*\{/.exec(contents.slice(anchorIndex, regionEnd));

  if (existing) {
    const start = anchorIndex + existing.index;
    const end = endOfBlock(contents, contents.indexOf('{', start));
    if (end === -1) return null;
    // `start` sits on the `release` keyword, so the file's own indentation in
    // front of it is preserved and the block supplies the rest.
    return contents.slice(0, start) + block.trimStart() + contents.slice(end);
  }

  const insertAt = anchorIndex + anchor.length;
  return contents.slice(0, insertAt) + block + contents.slice(insertAt);
}

function readSigningFromEnv() {
  const storeFile = process.env.FOOL_ANDROID_KEYSTORE;
  if (!storeFile) return null;

  return {
    // Gradle reads this as a Groovy string; backslashes would be escapes.
    storeFile: storeFile.replace(/\\/g, '/'),
    storePassword: process.env.FOOL_ANDROID_KEYSTORE_PASSWORD || '',
    keyAlias: process.env.FOOL_ANDROID_KEY_ALIAS || 'fool',
    keyPassword: process.env.FOOL_ANDROID_KEY_PASSWORD || '',
  };
}

const withReleaseSigning = (config) => {
  return withAppBuildGradle(config, (gradleConfig) => {
    const signing = readSigningFromEnv();
    if (!signing) return gradleConfig;

    if (gradleConfig.modResults.language !== 'groovy') {
      throw new Error(
        `withReleaseSigning expected a Groovy build.gradle, got ${gradleConfig.modResults.language}`,
      );
    }

    const withConfig = addReleaseSigningConfig(gradleConfig.modResults.contents, signing);
    if (!withConfig) {
      throw new Error('withReleaseSigning could not find the signingConfigs block');
    }

    const withRelease = pointReleaseAtReleaseKey(withConfig);
    if (!withRelease) {
      throw new Error('withReleaseSigning could not find the release build type');
    }

    gradleConfig.modResults.contents = withRelease;
    return gradleConfig;
  });
};

module.exports = withReleaseSigning;
