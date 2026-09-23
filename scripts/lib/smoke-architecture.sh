# shellcheck shell=bash
# Sourced by scripts/smoke-agent.sh: the binary's architecture must be the one its ARCHIVE
# name promises. Sets DESC, which smoke-signature.sh keys on.
# The asset NAME is a promise about the architecture inside, and the UI relies on
# it: macOS users are offered "Apple Silicon" and "Intel" as separate downloads
# precisely because we refuse to guess for them. A matrix entry pointing the
# wrong target at the wrong asset name would hand an Intel binary to an ARM Mac,
# which fails only after the download and reads as a broken release.
case "$ARCHIVE" in
  # One app for every Mac: both architectures, not merely "universal".
  *.dmg)        { lipo "$BIN" -verify_arch arm64 && lipo "$BIN" -verify_arch x86_64; } || { echo "::error::the app's agent is not arm64 + x86_64: $(lipo -archs "$BIN")" >&2; exit 1; }
                echo "  architectures: $(lipo -archs "$BIN")"; WANT="" ;;
  *macos-arm64*) WANT="arm64" ;;
  *macos-x64*)   WANT="x86_64" ;;
  *linux-x64*)   WANT="x86-64" ;;
  *windows-x64*) WANT="x86-64" ;;
  *)             WANT="" ;;
esac
# Read for every artefact: the signature check below keys on it, and an unset DESC there under
# `set -u` does not fail the run -- it skips the check.
DESC="$(file -b "$BIN")"
if [ -n "$WANT" ]; then
  case "$DESC" in
    *"$WANT"*) echo "  architecture matches the asset name ($WANT)" ;;
    *) echo "::error::$ARCHIVE claims $WANT but the binary is: $DESC" >&2; exit 1 ;;
  esac
fi
