#!/usr/bin/env bash
# Prints the version this release run builds, and refuses a tag that disagrees with it.
#
#   scripts/release-version.sh <agent Cargo.toml> <git ref>
#
# The agent crate's Cargo.toml `version` is the release version: `citadel-agent --version`
# prints it, and every artefact is checked against what this prints. On a tag push the tag
# must say the same (`agent-vX.Y.Z` for Cargo's X.Y.Z), or a release named 0.7.0 would ship
# binaries that call themselves 0.6.0. Any other ref (a dispatch) builds Cargo's version.
set -euo pipefail

usage="usage: release-version.sh <Cargo.toml> <git-ref>"
MANIFEST="${1:?$usage}"; REF="${2:?$usage}"
[ -f "$MANIFEST" ] || { echo "::error::no such manifest: $MANIFEST" >&2; exit 1; }

cargo_version="$(python3 - "$MANIFEST" <<'PY'
import sys, tomllib
with open(sys.argv[1], "rb") as f:
    print(tomllib.load(f)["package"]["version"])
PY
)"
[[ "$cargo_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || { echo "::error::$MANIFEST's version '$cargo_version' is not MAJOR.MINOR.PATCH" >&2; exit 1; }

case "$REF" in
  refs/tags/agent-v*)
    tag_version="${REF#refs/tags/agent-v}"
    if [ "$tag_version" != "$cargo_version" ]; then
      echo "::error::the tag says ${tag_version} but $MANIFEST says ${cargo_version}. Bump the crate's version and tag that commit, or tag agent-v${cargo_version}." >&2
      exit 1
    fi ;;
  refs/tags/*)
    echo "::error::$REF is not an agent-vX.Y.Z tag" >&2; exit 1 ;;
esac
echo "$cargo_version"
