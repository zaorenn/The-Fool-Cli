/**
 * Config plugin that permits cleartext HTTP in every build type.
 *
 * The app reaches the desktop over the local network at `http://<host>:<port>`
 * (see `src/services/api.ts` and `src/services/qrLogin.ts`). Android has blocked
 * cleartext traffic by default since API 28, and the generated project only
 * lifts that block in `android/app/src/debug/AndroidManifest.xml`. A release APK
 * therefore installs and launches but fails every request to the desktop, which
 * looks like a server problem rather than a manifest one.
 *
 * A per-address exemption is not possible: Android's network security config
 * matches domains, not address ranges, and the desktop's LAN address changes.
 */

const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const withCleartextTraffic = (config) => {
  return withAndroidManifest(config, (manifestConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      manifestConfig.modResults,
    );
    application.$['android:usesCleartextTraffic'] = 'true';
    return manifestConfig;
  });
};

module.exports = withCleartextTraffic;
