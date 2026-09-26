#!/usr/bin/env bash
# Proves the Linux agent runs on distributions older than the machine that built it.
#
#   scripts/smoke-linux-portability.sh <citadel-agent binary>
#
# agent-v0.7.0 was linked against the build runner's glibc 2.38: on Ubuntu 22.04 LTS (2.35)
# and Debian 12 (2.36) it exited "GLIBC_2.38 not found", after a .deb that declared no libc
# version had installed without complaint. The agent is now a static musl binary; this checks
# that it is one, and that it starts on each image below, which is what a person installing
# it on one of those systems needs.
#
# Needs docker. The images are the oldest still-supported releases of the distributions the
# download page names, plus Alpine, which has no glibc at all.
set -euo pipefail
BIN="$(readlink -f "${1:?usage: smoke-linux-portability.sh <citadel-agent binary>}")"
[ -f "$BIN" ] || { echo "::error::no such binary: $BIN" >&2; exit 1; }

# `file` is the portable way to ask; ldd's output for a static binary differs between libcs.
case "$(file -b "$BIN")" in
  *"statically linked"*|*"static-pie linked"*) echo "ok static: $(file -b "$BIN" | cut -d, -f1-2)" ;;
  *) echo "::error::$BIN is dynamically linked; it runs only where the build machine's libc is: $(file -b "$BIN")" >&2; exit 1 ;;
esac

for image in ubuntu:20.04 ubuntu:22.04 debian:11 debian:12 alpine:3.20; do
  # Pulled first and quietly, so what is captured below is the agent's own output, not
  # docker's pull progress (which printed as the "version" on the first CI run).
  docker pull -q --platform linux/amd64 "$image" >/dev/null
  if out="$(docker run --rm --platform linux/amd64 -v "$BIN:/citadel-agent:ro" "$image" /citadel-agent --version 2>&1)" \
      && [[ "$out" =~ ^citadel-agent\ [0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "ok $image: $out"
  else
    echo "::error::the agent does not start on $image: $out" >&2
    exit 1
  fi
done
