#!/usr/bin/env bash
# The menu-bar app's updater (apps/macos-agent/AppUpdater.swift, UpdateSteps.swift): its sequence
# against scripted steps, the bundle swap on scratch directories and, given a signed and
# notarised Citadel Agent.app, the real verification on a scratch disk image of a copy of it.
#
#   scripts/test-macos-agent-updater.sh [<Citadel Agent.app> <its version>]
#
# The app given is only read (ditto copies it); nothing is installed, launched or swapped.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/apps/macos-agent"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
swiftc -swift-version 5 -framework AppKit -framework Security \
  "$SRC/AppUpdater.swift" "$SRC/UpdateSteps.swift" "$SRC/AgentProcess.swift" "$SRC/Support.swift" \
  "$SRC/tests/main.swift" -o "$out/test-updater"
"$out/test-updater" "$@"
