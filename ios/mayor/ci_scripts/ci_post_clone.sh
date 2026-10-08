#!/bin/sh
# Xcode Cloud post-clone script — ios/mayor/ci_scripts/ci_post_clone.sh
# The Mayor iOS app is dependency-free (no CocoaPods / no external SPM packages),
# so there is nothing to install. This script is a safety net: it verifies the
# build environment and fails fast with a clear message if Xcode is too old.
set -euo pipefail

echo "=== The Mayor — Xcode Cloud post-clone ==="
xcodebuild -version || { echo "ERROR: xcodebuild not found"; exit 1; }

# Require Xcode 16+ (Swift 5.9, iOS 17 SDK).
XCODE_MAJOR="$(xcodebuild -version | head -n1 | awk '{print $2}' | cut -d. -f1)"
if [ "${XCODE_MAJOR:-0}" -lt 16 ]; then
  echo "ERROR: Xcode 16+ required (found major version ${XCODE_MAJOR:-unknown})."
  echo "Set the Xcode version in the Xcode Cloud workflow Environment tab."
  exit 1
fi
echo "Xcode version OK."
echo "No dependencies to install (zero third-party deps by design)."
