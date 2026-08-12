#!/usr/bin/env bash
# prepare-release-assets.sh
#
# Normalize electron-updater metadata from multi-arch build artifacts
# into a deterministic release-assets/ directory.
#
# Usage:
#   ./scripts/prepare-release-assets.sh [ARTIFACTS_DIR] [OUTPUT_DIR]
#
# Defaults:
#   ARTIFACTS_DIR = build-artifacts
#   OUTPUT_DIR    = release-assets

set -euo pipefail

ARTIFACTS_DIR="${1:-build-artifacts}"
OUTPUT_DIR="${2:-release-assets}"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# ---------------------------------------------------------------------------
# 1) Copy all distributables (unique file names)
# ---------------------------------------------------------------------------
echo "==> Copying distributables from $ARTIFACTS_DIR ..."
DISTRIBUTABLES=()
while IFS= read -r file; do
  DISTRIBUTABLES+=("$file")
done < <(find "$ARTIFACTS_DIR" -type f \( \
  -name "*.exe" -o \
  -name "*.msi" -o \
  -name "*.dmg" -o \
  -name "*.deb" -o \
  -name "*.zip" \
\) | sort)

DUPLICATE_BASENAMES=$(for file in "${DISTRIBUTABLES[@]}"; do basename "$file"; done | sort | uniq -d || true)
if [ -n "$DUPLICATE_BASENAMES" ]; then
  echo "::error::Found duplicate distributable basenames that would be overwritten in flat output:"
  echo "$DUPLICATE_BASENAMES"
  exit 1
fi

for file in "${DISTRIBUTABLES[@]}"; do
  cp -f "$file" "$OUTPUT_DIR/"
done

# ---------------------------------------------------------------------------
# 1b) Copy web-cli tarballs (+ sha256 checksums)
# ---------------------------------------------------------------------------
echo "==> Copying web-cli tarballs from $ARTIFACTS_DIR ..."
WEB_CLI_FILES=()
while IFS= read -r file; do
  WEB_CLI_FILES+=("$file")
done < <(find "$ARTIFACTS_DIR" -type f \( \
  -name "fool-web-*.tar.gz" -o \
  -name "fool-web-*.tar.gz.sha256" \
\) | sort)

WEB_CLI_DUPS=$(for file in "${WEB_CLI_FILES[@]}"; do basename "$file"; done | sort | uniq -d || true)
if [ -n "$WEB_CLI_DUPS" ]; then
  echo "::error::Duplicate web-cli artifact basenames:"
  echo "$WEB_CLI_DUPS"
  exit 1
fi

for file in "${WEB_CLI_FILES[@]}"; do
  cp -f "$file" "$OUTPUT_DIR/"
done

# ---------------------------------------------------------------------------
# 1c) Copy install-web.sh (version-substituted)
# ---------------------------------------------------------------------------
echo "==> Copying install-web.sh ..."
INSTALL_SCRIPT=$(find "$ARTIFACTS_DIR" -type f -name 'install-web.sh' | head -n 1 || true)
if [ -n "$INSTALL_SCRIPT" ]; then
  cp -f "$INSTALL_SCRIPT" "$OUTPUT_DIR/install-web.sh"
  chmod +x "$OUTPUT_DIR/install-web.sh"
fi

# ---------------------------------------------------------------------------
# 2) Collect updater metadata from each platform artifact directory
# ---------------------------------------------------------------------------
echo "==> Collecting updater metadata ..."

WIN_X64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/windows-build-x64/*" -name "latest.yml" | sort | head -n 1 || true)
WIN_ARM64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/windows-build-arm64/*" -name "latest.yml" | sort | head -n 1 || true)
MAC_X64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/macos-build-x64/*" -name "latest-mac.yml" | sort | head -n 1 || true)
MAC_ARM64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/macos-build-arm64/*" -name "latest-mac.yml" | sort | head -n 1 || true)
LINUX_X64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/linux-build-x64/*" -name "latest-linux.yml" | sort | head -n 1 || true)
LINUX_ARM64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/linux-build-arm64/*" -name "latest-linux-arm64.yml" | sort | head -n 1 || true)

# ---------------------------------------------------------------------------
# 3) Publish deterministic canonical metadata for electron-updater
#    (avoid nondeterministic overwrite when multiple jobs produce same names)
# ---------------------------------------------------------------------------
echo "==> Writing canonical updater metadata ..."

[ -n "$WIN_X64_LATEST" ]    && cp -f "$WIN_X64_LATEST"    "$OUTPUT_DIR/latest.yml"
[ -n "$MAC_X64_LATEST" ]    && cp -f "$MAC_X64_LATEST"    "$OUTPUT_DIR/latest-mac.yml"
[ -n "$LINUX_X64_LATEST" ]  && cp -f "$LINUX_X64_LATEST"  "$OUTPUT_DIR/latest-linux.yml"
[ -n "$LINUX_ARM64_LATEST" ] && cp -f "$LINUX_ARM64_LATEST" "$OUTPUT_DIR/latest-linux-arm64.yml"

# ---------------------------------------------------------------------------
# 4) Architecture-specific metadata required by electron-updater
# ---------------------------------------------------------------------------
echo "==> Writing architecture-specific updater metadata ..."

[ -n "$WIN_ARM64_LATEST" ]  && cp -f "$WIN_ARM64_LATEST"  "$OUTPUT_DIR/latest-win-arm64.yml"

# electron-updater on macOS constructs the yml filename as "${channel}-mac.yml".
# For arm64, channel is "latest-arm64", so it looks for "latest-arm64-mac.yml".
[ -n "$MAC_ARM64_LATEST" ]  && cp -f "$MAC_ARM64_LATEST"  "$OUTPUT_DIR/latest-arm64-mac.yml"

# ---------------------------------------------------------------------------
# 5) Validation
#
# The rule here is consistency, not completeness.
#
# A platform that did not build leaves nothing behind, and refusing to publish
# because of it is how this project reached 2.5.2 without a single release: the
# Windows installers were sitting in the artifacts every time. A platform that
# *did* build but is missing the metadata the updater needs is a packaging bug,
# and that still fails the job.
#
# Windows is the exception, and is required outright: `latest.yml` and the .exe
# are what the update feed serves.
#
# File names come from `artifactName` in packages/desktop/electron-builder.yml,
# which is `TheFool-${version}-${os}-${arch}.${ext}` — no space. This block used
# to look for `The Fool-...`, matched nothing a real build produces, and would
# have failed the release job on the first run that ever reached it.
# ---------------------------------------------------------------------------
echo "==> Validating release assets ..."

VERSION="${MOCK_VERSION:-}"
if [ -z "$VERSION" ] && [ -f "$OUTPUT_DIR/latest.yml" ]; then
  VERSION="$(sed -n 's/^version:[[:space:]]*//p' "$OUTPUT_DIR/latest.yml" | head -n 1)"
fi
if [ -z "$VERSION" ]; then
  command -v node >/dev/null 2>&1 || { echo "::error::Unable to resolve release version"; exit 1; }
  VERSION="$(node -p "require('./package.json').version")"
fi

MISSING=0
ABSENT=""

fail() {
  echo "::error::$1"
  MISSING=1
}

# Whether a platform built is decided by its artifact *directory* (section 2),
# which the build matrix names and is therefore stable. What it had to produce
# is then matched by file *shape* rather than exact name, so that a version
# bump or a rename of the product cannot silently turn a check into a no-op —
# which is precisely what `The Fool-*` did here.
#
# `-print -quit` rather than `| grep -q .`: under `set -o pipefail`, grep exiting
# on the first match can leave find killed by SIGPIPE, and the pipeline then
# reports 141 even though the file was there.
has() {
  [ -n "$(find "$OUTPUT_DIR" -maxdepth 1 -type f -name "$1" -print -quit)" ]
}

# --- Windows: required ------------------------------------------------------
has '*.exe' || fail "No Windows installer: the update feed cannot be served without one"
[ -f "$OUTPUT_DIR/latest.yml" ] || fail "Missing required updater metadata: latest.yml"

if [ -n "$WIN_ARM64_LATEST" ]; then
  has '*win-arm64.exe' || fail "Windows arm64 built but its installer is missing"
fi

# --- macOS: only what actually built ----------------------------------------
if [ -n "$MAC_X64_LATEST" ]; then
  has '*mac-x64.dmg' || fail "macOS x64 built but its DMG is missing"
  has '*mac-x64.zip' || fail "macOS x64 built but its zip is missing"
else
  ABSENT="$ABSENT macOS-x64"
fi

if [ -n "$MAC_ARM64_LATEST" ]; then
  has '*mac-arm64.dmg' || fail "macOS arm64 built but its DMG is missing"
  has '*mac-arm64.zip' || fail "macOS arm64 built but its zip is missing"
  [ -f "$OUTPUT_DIR/latest-arm64-mac.yml" ] || fail "macOS arm64 built but latest-arm64-mac.yml is missing"
else
  ABSENT="$ABSENT macOS-arm64"
fi

# --- Linux: same rule -------------------------------------------------------
if [ -n "$LINUX_X64_LATEST" ]; then
  has '*.deb' || fail "Linux x64 built but no .deb was collected"
else
  ABSENT="$ABSENT linux-x64"
fi

if [ -n "$LINUX_ARM64_LATEST" ]; then
  has '*arm64.deb' || fail "Linux arm64 built but its .deb is missing"
else
  ABSENT="$ABSENT linux-arm64"
fi

# --- web-cli: all five or none ---------------------------------------------
# `install-web.sh` picks a tarball by platform at run time, so a partial set is
# an installer that fails for some users. A complete absence just means the
# packing workflow did not run.
echo "==> Validating web-cli assets ..."

WEB_PLATFORMS=(
  "darwin-arm64"
  "darwin-x86_64"
  "linux-arm64"
  "linux-x86_64"
  "win-x86_64"
)

WEB_PRESENT=0
for plat in "${WEB_PLATFORMS[@]}"; do
  if [ -f "$OUTPUT_DIR/fool-web-${VERSION}-${plat}.tar.gz" ]; then
    WEB_PRESENT=1
  fi
done

if [ "$WEB_PRESENT" -eq 1 ]; then
  for plat in "${WEB_PLATFORMS[@]}"; do
    tarball="fool-web-${VERSION}-${plat}.tar.gz"
    [ -f "$OUTPUT_DIR/$tarball" ] || fail "Missing web-cli tarball: $tarball"
    [ -f "$OUTPUT_DIR/${tarball}.sha256" ] || fail "Missing web-cli checksum: ${tarball}.sha256"
  done
  [ -f "$OUTPUT_DIR/install-web.sh" ] || fail "Missing install-web.sh"
else
  ABSENT="$ABSENT web-cli"
fi

if [ -n "$ABSENT" ]; then
  echo "::warning title=Partial release::no build for$ABSENT — publishing the platforms that succeeded"
fi

if [ "$MISSING" -ne 0 ]; then
  exit 1
fi

echo ""
echo "==> Prepared release assets:"
ls -lh "$OUTPUT_DIR"
echo ""
echo "==> Done."
