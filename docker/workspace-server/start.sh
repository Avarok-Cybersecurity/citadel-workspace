#!/bin/sh
# The workspace server image's start: make the sign-in seed if this data volume has none, then
# run the server. The seed is made here, visibly, and never by the server itself: a server that
# made one whenever it found none would silently lock out every post-quantum account the first
# time the volume was missing. SEED must be kernel.toml's [sign_in] oprf_seed_file
# (tests/the_shipped_sign_in_config_starts.rs holds the two together).
set -eu

SEED=/data/server/sign-in/oprf-seed
CONFIG=/usr/src/app/kernel.toml

if [ ! -e "$SEED" ]; then
  echo "start: no sign-in seed at $SEED; creating one (first start of this data volume)"
  /usr/local/bin/citadel-workspace-server-kernel --init-sign-in-seed "$SEED"
fi
exec /usr/local/bin/citadel-workspace-server-kernel --config "$CONFIG"
