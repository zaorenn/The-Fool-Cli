#!/usr/bin/env node
/**
 * Builds an installable, self-contained Android APK locally, with no Expo
 * account and no USB-attached device.
 *
 * The existing `scripts/build.js` shells out to `eas build`, which needs an
 * Expo login even in `--local` mode, and its iOS branch reads passwords from the
 * macOS keychain. This script takes the account-free path instead: it generates
 * the native project with `expo prebuild` and drives Gradle directly.
 *
 * The APK is signed with a keystore that lives outside the repository and is
 * created once, so every later build installs over the previous one as an
 * update instead of being rejected for a signature mismatch.
 *
 * Usage:
 *   node scripts/buildApk.js              release build, bumps buildNumber
 *   node scripts/buildApk.js --no-bump    keep the current buildNumber
 *   node scripts/buildApk.js --clean      regenerate android/ from scratch
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const MOBILE_ROOT = path.join(__dirname, '..');
const ANDROID_DIR = path.join(MOBILE_ROOT, 'android');
const VERSION_FILE = path.join(MOBILE_ROOT, 'versions', 'version.json');
const SIGNING_DIR = path.join(os.homedir(), '.fool', 'android');
const KEYSTORE_FILE = path.join(SIGNING_DIR, 'fool-release.jks');
const SIGNING_META = path.join(SIGNING_DIR, 'signing.json');
const KEY_ALIAS = 'fool';

const args = process.argv.slice(2);
const shouldBump = !args.includes('--no-bump');
const shouldClean = args.includes('--clean');

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  // stdio is inherited rather than piped: a piped exit code belongs to the pipe,
  // not to the build, and a failed build would otherwise look like a success.
  execFileSync(command, commandArgs, {
    stdio: 'inherit',
    cwd: options.cwd || MOBILE_ROOT,
    env: options.env || process.env,
  });
}

/** Finds a JDK, preferring JAVA_HOME and falling back to a standard install. */
function resolveJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }

  const roots = [
    // Where a JDK unpacked next to the Android SDK lands, which is what an
    // install without administrator rights produces.
    'C:\\Android\\jdk',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Microsoft',
  ];

  const javac = process.platform === 'win32' ? 'javac.exe' : 'javac';

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const candidates = fs
      .readdirSync(root)
      .filter((name) => /jdk/i.test(name))
      .map((name) => path.join(root, name))
      .filter((dir) => fs.existsSync(path.join(dir, 'bin', javac)));
    if (candidates.length > 0) {
      candidates.sort();
      return candidates[candidates.length - 1];
    }
  }

  return null;
}

/**
 * Java keeps its own list of trusted certificate authorities and ignores the
 * one Windows maintains. A TLS-inspecting antivirus (Avast's Web Shield, for
 * one) re-signs every HTTPS response with a root that Windows trusts and Java
 * does not, so sdkmanager and Gradle fail their downloads with a PKIX path
 * error while a browser on the same machine works. Pointing the JVM at the
 * Windows store reads the certificates the machine already trusts; it adds no
 * trust of its own.
 *
 * Set FOOL_ANDROID_NO_WINDOWS_TRUSTSTORE=1 to opt out.
 */
function trustStoreArgs() {
  if (process.platform !== 'win32') return [];
  if (process.env.FOOL_ANDROID_NO_WINDOWS_TRUSTSTORE === '1') return [];
  return ['-Djavax.net.ssl.trustStoreType=WINDOWS-ROOT'];
}

function resolveAndroidHome() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    'C:\\Android\\Sdk',
    path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Creates the release keystore on first run. The password is generated once and
 * stored next to the key, which is what makes later builds reproducible: the
 * same key produces the same signature, and Android accepts the install as an
 * update.
 */
function ensureKeystore(javaHome) {
  if (fs.existsSync(KEYSTORE_FILE) && fs.existsSync(SIGNING_META)) {
    return JSON.parse(fs.readFileSync(SIGNING_META, 'utf8'));
  }

  if (fs.existsSync(KEYSTORE_FILE) !== fs.existsSync(SIGNING_META)) {
    fail(
      `Signing state is half present in ${SIGNING_DIR}.\n` +
        'Delete that directory to start over, but note that a new key means the\n' +
        'next APK will not install over an app signed with the old one.',
    );
  }

  fs.mkdirSync(SIGNING_DIR, { recursive: true });

  const password = crypto.randomBytes(24).toString('base64url');
  const keytool = path.join(javaHome, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool');

  console.log(`Creating release keystore at ${KEYSTORE_FILE}`);
  run(keytool, [
    '-genkeypair',
    '-v',
    '-keystore',
    KEYSTORE_FILE,
    '-alias',
    KEY_ALIAS,
    '-keyalg',
    'RSA',
    '-keysize',
    '2048',
    '-validity',
    '10000',
    '-storepass',
    password,
    '-keypass',
    password,
    '-dname',
    'CN=The Fool, OU=Local Build, O=The Fool, L=Local, S=Local, C=US',
  ]);

  const meta = { keystore: KEYSTORE_FILE, alias: KEY_ALIAS, password };
  fs.writeFileSync(SIGNING_META, JSON.stringify(meta, null, 2) + '\n');
  console.log('Keystore created. Keep this directory: losing it means future');
  console.log('builds can no longer update an already installed app.\n');

  return meta;
}

function writeVersion(versionData) {
  fs.writeFileSync(VERSION_FILE, JSON.stringify(versionData, null, 2) + '\n');
}

function bumpBuildNumber() {
  const versionData = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
  if (!shouldBump) return { versionData, previous: versionData.buildNumber };

  const previous = versionData.buildNumber;
  versionData.buildNumber = previous + 1;
  writeVersion(versionData);
  console.log(`Bumped buildNumber: ${previous} -> ${versionData.buildNumber}`);
  return { versionData, previous };
}

function main() {
  const javaHome = resolveJavaHome();
  if (!javaHome) {
    fail(
      'No JDK found. Install one, for example:\n' +
        '  winget install --id EclipseAdoptium.Temurin.17.JDK -e --source winget',
    );
  }

  const androidHome = resolveAndroidHome();
  if (!androidHome) {
    fail(
      'No Android SDK found. Install the command line tools and point\n' +
        'ANDROID_HOME at the SDK directory.',
    );
  }

  console.log(`JAVA_HOME    ${javaHome}`);
  console.log(`ANDROID_HOME ${androidHome}\n`);

  const signing = ensureKeystore(javaHome);
  const { versionData, previous } = bumpBuildNumber();

  const jvmTrust = trustStoreArgs();
  const env = {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
    // Reaches the wrapper JVM, which downloads the Gradle distribution itself.
    JAVA_OPTS: [process.env.JAVA_OPTS, ...jvmTrust].filter(Boolean).join(' '),
    GRADLE_OPTS: [process.env.GRADLE_OPTS, ...jvmTrust].filter(Boolean).join(' '),
    FOOL_ANDROID_KEYSTORE: signing.keystore,
    FOOL_ANDROID_KEYSTORE_PASSWORD: signing.password,
    FOOL_ANDROID_KEY_ALIAS: signing.alias,
    FOOL_ANDROID_KEY_PASSWORD: signing.password,
  };

  const prebuildArgs = ['expo', 'prebuild', '--platform', 'android', '--no-install'];
  if (shouldClean) prebuildArgs.push('--clean');

  try {
    buildWith({ env, prebuildArgs, jvmTrust, versionData });
  } catch (error) {
    // A version number that was consumed by a build that never produced an APK
    // would make the next successful build look like it skipped a release.
    if (shouldBump) {
      versionData.buildNumber = previous;
      writeVersion(versionData);
      console.error(`\nBuild failed. Reverted buildNumber to ${previous}.`);
    }
    process.exit(typeof error.status === 'number' ? error.status : 1);
  }
}

/**
 * Node refuses to spawn a .cmd or .bat file directly, so on Windows both `npx`
 * and `gradlew` need the command interpreter in front of them. Naming cmd
 * explicitly keeps each argument its own argv entry; `shell: true` concatenates
 * them, and the jvmargs value would be split on its spaces.
 */
function viaInterpreter(executable, executableArgs) {
  if (process.platform !== 'win32') {
    return { command: executable, args: executableArgs };
  }

  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', executable, ...executableArgs],
  };
}

function buildWith({ env, prebuildArgs, jvmTrust, versionData }) {
  console.log('Generating the native project...');
  const prebuild = viaInterpreter('npx', prebuildArgs);
  run(prebuild.command, prebuild.args, { env });

  console.log('\nBuilding the release APK...');
  const gradlew = path.join(
    ANDROID_DIR,
    process.platform === 'win32' ? 'gradlew.bat' : 'gradlew',
  );
  const gradleArgs = ['assembleRelease', '--no-daemon'];
  if (jvmTrust.length > 0) {
    // The build runs in a forked JVM that does not inherit GRADLE_OPTS, and it
    // is the one that downloads dependencies, so it needs the flag as well.
    const jvmargs = ['-Xmx2048m', '-XX:MaxMetaspaceSize=512m', ...jvmTrust].join(' ');
    gradleArgs.push(`-Dorg.gradle.jvmargs=${jvmargs}`);
  }

  const gradle = viaInterpreter(gradlew, gradleArgs);
  run(gradle.command, gradle.args, { cwd: ANDROID_DIR, env });

  const built = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  if (!fs.existsSync(built)) {
    // A zero exit code is not evidence that anything was written to disk.
    throw new Error(`Gradle reported success but ${built} does not exist.`);
  }

  const target = path.join(
    MOBILE_ROOT,
    `build-${versionData.version}-${versionData.buildNumber}.apk`,
  );
  fs.copyFileSync(built, target);

  const megabytes = (fs.statSync(target).size / (1024 * 1024)).toFixed(1);
  console.log(`\nAPK ready: ${target} (${megabytes} MB)`);
}

main();
