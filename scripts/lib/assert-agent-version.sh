#!/usr/bin/env bash
# Runs an agent with --version and requires it to run and to print exactly the expected version.
#
#   scripts/lib/assert-agent-version.sh <expected X.Y.Z> <command> [args...]
#
# The command is how the artefact is started (a binary, a launcher, an AppImage with
# --appimage-extract-and-run); --version is appended. The agent prints "citadel-agent X.Y.Z",
# from its Cargo.toml, and the release gates hold that to the tag (scripts/release-version.sh).
# An artefact built from another commit, or packaging a stale binary, prints something else.
set -euo pipefail

EXPECTED="${1:?usage: assert-agent-version.sh <expected> <command> [args...]}"
shift
[ "$#" -gt 0 ] || { echo "usage: assert-agent-version.sh <expected> <command> [args...]" >&2; exit 2; }
[[ "$EXPECTED" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "::error::expected version '$EXPECTED' is not MAJOR.MINOR.PATCH" >&2; exit 2; }

set +e
got="$("$@" --version 2>&1)"
rc=$?
set -e
got="${got//$'\r'/}"   # a Windows console ends the line with CR LF
if [ "$rc" -ne 0 ]; then
  echo "::error::'$* --version' exited $rc: ${got:-<no output>}" >&2
  exit 1
fi
if [ "$got" != "citadel-agent $EXPECTED" ]; then
  echo "::error::'$* --version' printed '${got}', expected exactly 'citadel-agent $EXPECTED'" >&2
  exit 1
fi
echo "  --version: $got"
