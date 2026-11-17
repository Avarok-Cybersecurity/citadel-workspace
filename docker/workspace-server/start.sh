#!/bin/sh
# The workspace server image's start: make the sign-in seed and the server key if this data
# volume has none, then run the server. Both are made here, visibly, and never by the server
# itself: a server that made a seed whenever it found none would silently lock out every
# post-quantum account the first time the volume was missing, and a new key makes every client
# that pinned this server refuse it. SEED must be kernel.toml's [sign_in] oprf_seed_file and
# SERVER_KEY its [identity] server_key_file (tests/the_shipped_sign_in_config_starts.rs and
# tests/t9_identity_config.rs hold them together).
set -eu

SEED=/data/server/sign-in/oprf-seed
SERVER_KEY=/data/server/identity/server-key
CONFIG=/usr/src/app/kernel.toml

if [ ! -e "$SEED" ]; then
  echo "start: no sign-in seed at $SEED; creating one (first start of this data volume)"
  /usr/local/bin/citadel-workspace-server-kernel --init-sign-in-seed "$SEED"
fi
if [ ! -e "$SERVER_KEY" ]; then
  echo "start: no server key at $SERVER_KEY; creating one (first start of this data volume)"
  /usr/local/bin/citadel-workspace-server-kernel --init-server-key "$SERVER_KEY"
fi
exec /usr/local/bin/citadel-workspace-server-kernel --config "$CONFIG"
