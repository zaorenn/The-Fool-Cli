/**
 * The plugin rewrites `android/app/build.gradle` during prebuild. `expo prebuild`
 * without `--clean` reuses the existing android directory and runs the mods over
 * a file the plugin already edited, so every transform has to survive being
 * applied twice.
 */

const withReleaseSigning = require('../../scripts/withReleaseSigning');

type GradleMod = {
  modResults: { language: string; contents: string };
};

type ModAction = (config: GradleMod) => GradleMod;

// The plugin is registered through withAppBuildGradle, which is not available
// outside a prebuild run. Capturing the action lets the transform be exercised
// on its own.
jest.mock('@expo/config-plugins', () => ({
  withAppBuildGradle: (config: unknown, action: ModAction) => ({ config, action }),
}));

const SIGNING_ENV = {
  FOOL_ANDROID_KEYSTORE: 'C:\\Users\\someone\\.fool\\android\\fool-release.jks',
  FOOL_ANDROID_KEYSTORE_PASSWORD: 'secret-pass',
  FOOL_ANDROID_KEY_ALIAS: 'fool',
  FOOL_ANDROID_KEY_PASSWORD: 'secret-pass',
};

/** The shape `expo prebuild` generates, reduced to the parts the plugin reads. */
const TEMPLATE = `android {
    namespace 'ai.resopod.fool'
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}
`;

function applyPlugin(contents: string): string {
  const { action } = withReleaseSigning({}) as unknown as { action: ModAction };
  const result = action({ modResults: { language: 'groovy', contents } });
  return result.modResults.contents;
}

describe('withReleaseSigning', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ...SIGNING_ENV };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('points the release build type at the release keystore', () => {
    const output = applyPlugin(TEMPLATE);

    const releaseBuildType = output.slice(output.indexOf('buildTypes {'));
    expect(releaseBuildType).toContain('signingConfig signingConfigs.release');
  });

  it('leaves the debug build type signing with the debug keystore', () => {
    const output = applyPlugin(TEMPLATE);

    const buildTypes = output.slice(output.indexOf('buildTypes {'));
    const debugBlock = buildTypes.slice(buildTypes.indexOf('debug {'), buildTypes.indexOf('release {'));
    expect(debugBlock).toContain('signingConfig signingConfigs.debug');
  });

  it('adds a release signing config carrying the keystore from the environment', () => {
    const output = applyPlugin(TEMPLATE);

    expect(output).toContain("storeFile file('C:/Users/someone/.fool/android/fool-release.jks')");
    expect(output).toContain("storePassword 'secret-pass'");
    expect(output).toContain("keyAlias 'fool'");
  });

  it('produces the same file when applied twice', () => {
    const once = applyPlugin(TEMPLATE);
    const twice = applyPlugin(once);

    expect(twice).toBe(once);
  });

  it('refreshes a stale keystore path left by an earlier prebuild', () => {
    const stale = applyPlugin(TEMPLATE);
    process.env.FOOL_ANDROID_KEYSTORE = 'D:\\keys\\other.jks';

    const output = applyPlugin(stale);

    expect(output).toContain("storeFile file('D:/keys/other.jks')");
    expect(output).not.toContain('fool-release.jks');
  });

  it('does nothing when no keystore is configured', () => {
    delete process.env.FOOL_ANDROID_KEYSTORE;

    expect(applyPlugin(TEMPLATE)).toBe(TEMPLATE);
  });
});
