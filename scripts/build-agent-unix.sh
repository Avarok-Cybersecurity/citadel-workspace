#!/usr/bin/env bash
# The macOS and Linux agent as it ships: the release build with this repository's source-path
# remapping (scripts/lib/remap-paths.mjs), then the shipped-artefact gate on the binary it
# produced. One script for the release legs (.github/actions/build-agent) and the PR job
# (validate.yml's unix-agents), so a PR builds exactly what the release gate will judge.
# scripts/build-agent-windows.ps1 is the Windows counterpart.
#
#   scripts/build-agent-unix.sh <target-triple>
set -euo pipefail

target="${1:?usage: build-agent-unix.sh <target-triple>}"

# native-dialogs: the PickFile request opens the OS file dialog (reported to the UI in the
# greeting as native_picker). Linux goes through the desktop portal (rfd's xdg-portal backend,
# no GTK needed). macOS stays off: rfd panics there ("NonWindowed environment ... thread
# different than main") and the agent's panic hook then exits the whole agent. Verified by
# sending PickFile to a macOS build.
features=vendored,self-update
case "$(uname -s)" in
  Linux) features="$features,native-dialogs" ;;
  Darwin) ;;
  *) echo "build-agent-unix.sh: unsupported host $(uname -s)" >&2; exit 1 ;;
esac

# Source paths mapped: agent-v0.13.0 carried 6,318 /Users/runner/.cargo/... strings. Each is
# assigned before it is exported, so a failure stops the script.
for mode in "" --cflags --cxxflags; do
  remap="$(node scripts/remap-path-env.mjs $mode "$target")"
  export "${remap?}"
done

cargo build --release --target "$target" -p citadel-workspace-internal-service \
  --bin citadel-workspace-internal-service --features "$features"

# Vendored OpenSSL compiles its install prefix in (ENGINESDIR, MODULESDIR): a C configure path no
# compiler flag maps, under the checkout, which is under /home/runner on Linux.
node scripts/check-no-home-paths-shipped.mjs \
  --allow-under "$PWD/target/$target/release/build/openssl-sys/" \
  "target/$target/release/citadel-workspace-internal-service"
