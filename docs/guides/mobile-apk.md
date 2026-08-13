# Building the mobile APK locally

`npm run android:device` needs a cable and a phone in developer mode. This route
produces a signed APK you can install from the phone's browser instead, and it
needs no Expo account: the build runs entirely on your machine.

The APK is self-contained. The JavaScript bundle is embedded
(`assets/index.android.bundle`), so the installed app does not need Metro, a
development server, or the machine that built it. It reaches the desktop over
Wi-Fi the same way the QR login always did.

## Prerequisites

A JDK and the Android SDK. Neither has to be on `PATH`; the build script looks
in the usual places and prints what it found.

- **JDK 17.** `winget install --id EclipseAdoptium.Temurin.17.JDK -e --source winget`,
  or unpack a Temurin archive anywhere and set `JAVA_HOME`.
- **Android SDK** with `platform-tools`, `platforms;android-36`,
  `build-tools;36.0.0` and `ndk;27.1.12297006`. The versions are not a
  preference: they come from `node_modules/react-native/gradle/libs.versions.toml`,
  which Expo reads as its version catalog. Install them with `sdkmanager` from
  Google's command line tools, then set `ANDROID_HOME`.

Gradle 9.0 and the Android Gradle Plugin both require JDK 17 or newer.

## Building

```bash
cd mobile
npm run apk
```

This bumps `versions/version.json`, runs `expo prebuild`, and drives Gradle
directly. It prints the path and size of the finished APK. If the build fails,
the version bump is rolled back so the number is not silently consumed.

`npm run apk:clean` regenerates `android/` from scratch first. Use it after
changing `app.config.ts` or a config plugin if a normal build behaves oddly; a
plain build reuses the existing native project.

The first build takes several minutes and downloads roughly 500 MB of Gradle
dependencies. Later builds reuse them and finish in about a minute.

## Installing on the phone

```bash
cd mobile
npm run apk:serve
```

It serves the newest APK and prints the addresses that a phone on the same Wi-Fi
can reach. Open one in the phone's browser and download. Android asks for
permission to install from that browser; the permission is per-app and can be
revoked afterwards.

Addresses are ordered so private LAN ranges come first, and link-local
(`169.254.x.x`) addresses are left out entirely — an adapter that failed to get
a lease still reports one, it looks like a perfectly good address, and nothing
on the network can reach it.

## Updates

The first build creates a keystore at `~/.fool/android/fool-release.jks` and
stores its generated password next to it. Every later build signs with that same
key, which is what lets a new APK install over the old one as an update instead
of being rejected for a signature mismatch. Android also requires the version
code to increase, which the build script handles.

Keep that directory. Losing it means future builds can no longer update an
installed app — only a full uninstall and reinstall, which drops the app's data.

The keystore never enters the repository. `scripts/withReleaseSigning.js` reads
its location and password from the environment during prebuild and writes them
into the generated `android/app/build.gradle`, which is gitignored. Without those
variables the plugin does nothing and the project keeps its stock debug signing,
so `expo run:android` is unaffected.

## When something goes wrong

**Downloads fail with a PKIX certificate error.** A TLS-inspecting antivirus
(Avast's Web Shield does this) re-signs HTTPS responses with a root that Windows
trusts and Java does not, so `sdkmanager` and Gradle fail while a browser on the
same machine works. The build script already points the JVM at the Windows
certificate store on Windows; for `sdkmanager`, set
`JAVA_OPTS=-Djavax.net.ssl.trustStoreType=WINDOWS-ROOT` yourself. Set
`FOOL_ANDROID_NO_WINDOWS_TRUSTSTORE=1` to opt out.

**`Incompatible magic value 0 in class file`, or a POM that fails to parse with
`Content is not allowed in prolog`.** A build that was killed part-way leaves
files in Gradle's caches that were allocated but never written. Nothing detects
them later; they simply fail to parse. Delete `~/.gradle/caches` and rebuild.
The included Gradle plugins compile inside `node_modules`, so those caches can
be corrupt too:

```bash
rm -rf ~/.gradle/caches mobile/android/.gradle mobile/android/build
```

**The build reaches `createBundleReleaseJsAndAssets` and fails there.** That task
runs Metro. A watch folder that does not exist is not survivable: Metro fails to
construct its transformer, bundles nothing, and reports only an exit code. Check
the paths in `mobile/metro.config.js` against the repository layout.

## Size

The APK carries native libraries for four ABIs, which is most of its ~114 MB. A
phone uses one of them. Restricting `reactNativeArchitectures` in
`android/gradle.properties` to `arm64-v8a` cuts the size substantially, at the
cost of an APK that no longer installs everywhere.
