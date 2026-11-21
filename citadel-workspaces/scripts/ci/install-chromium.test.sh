#!/usr/bin/env bash
# Tests for install-chromium.sh's lock wait and apt-archive cache, with no root and no network.
# The deadline -- that a hung apt-get dies with its attempt -- is install-chromium-deadline.test.sh.
# The stand-ins are install-chromium.fakes.sh; read its header first.
#
# Lock cases: a foreign apt holds the lock until a set fake-clock time. Each is run again against
# a copy with the wait removed, and must FAIL there: a case that passes either way is not
# testing the wait.
#
# Archive cases: a cold run must leave the packages in the cached dir; a warm one must install
# them from it with no `apt-get update` and no download (run 44530131940 had a warm cache and
# still went to a dead mirror); the dir saved must hold exactly the installed versions. Each is
# run again with its mechanism removed and must FAIL.
#
# Usage: bash scripts/ci/install-chromium.test.sh
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=install-chromium.fakes.sh
. "$(dirname "${BASH_SOURCE[0]}")/install-chromium.fakes.sh"

SUBJECT="$WORK/subject"; subject_copy "$SUBJECT"
FUSER_BIN="$WORK/bin-fuser"; make_fakes "$FUSER_BIN" yes yes
PGREP_BIN="$WORK/bin-pgrep"; make_fakes "$PGREP_BIN" no yes
BARE_BIN="$WORK/bin-bare"; make_fakes "$BARE_BIN" no no
fresh_dir() { mktemp -d "$WORK/archives.XXXX"; }

# --- the lock wait
case_lock_released() { # held for 20s, then free: waits, then installs once
  run "$1" "$2" 20 "$(fresh_dir)"
  [ "$CODE" -eq 0 ] && never_locked && installed && count_in browsers 1 \
    && has "apt's locks are free after 20s"
}
case_lock_never_released() { # the cap passes: it says so, then proceeds into apt, which names it
  run "$1" "$2" -1 "$(fresh_dir)"
  has "apt lock still held after 600s" && logged "apt-get LOCKED at 600s" && [ "$CODE" -eq 1 ] \
    && count_in browsers 0
}
LOCK_CASES=(case_lock_released case_lock_never_released)
for c in "${LOCK_CASES[@]}"; do
  expect "$c (fuser)" "$c" "$SUBJECT" "$FUSER_BIN"
  expect "$c probes with fuser" grep -q "^fuser /var/lib/dpkg/lock-frontend" "$STATE/probes"
done
expect "case_lock_released (pgrep fallback)" case_lock_released "$SUBJECT" "$PGREP_BIN"
expect "pgrep fallback probes apt by name" grep -q "^pgrep -x" "$STATE/probes"

run "$SUBJECT" "$BARE_BIN" 0 "$(fresh_dir)"
expect "no probe at all: refuses, exit 2, before any install" \
  eval '[ "$CODE" -eq 2 ] && has "neither fuser nor pgrep" && count_in browsers 0'
run "$SUBJECT" "$FUSER_BIN" 0 "$(fresh_dir)"
expect "lock free: installs at once, without waiting" eval 'installed && ! has "waiting for"'
expect "never --with-deps, whose apt-get update cannot be skipped" eval '! logged "npx refused"'

NO_WAIT="$WORK/no-wait"; subject_copy "$NO_WAIT"
mutate "$NO_WAIT/install-chromium.sh" 's/^  wait_for_apt_locks$/  : wait removed/'
for c in "${LOCK_CASES[@]}"; do control "$c passed with the wait removed" "$c" "$NO_WAIT" "$FUSER_BIN"; done

# --- arguments
run "$SUBJECT" "$FUSER_BIN" 0 ""
expect "no archive dir: usage, exit 64, before any install" eval '[ "$CODE" -eq 64 ] && count_in browsers 0'
run "$SUBJECT" "$FUSER_BIN" 0 relative/dir
expect "relative archive dir: refused, exit 2, before any install" \
  eval '[ "$CODE" -eq 2 ] && has "must be absolute" && count_in browsers 0'

# --- the archive cache
debs_in() { local d=("$1"/*.deb); [ -e "${d[0]}" ] && [ "${#d[@]}" -eq "$2" ]; }
case_cold_cache() { # <scripts> <dir> : an empty dir ends holding both packages, owned and tidy
  run "$1" "$FUSER_BIN" 0 "$2"
  [ "$CODE" -eq 0 ] && installed && debs_in "$2" 2 && has "0 cached package(s) restored" \
    && has "2 package(s) in $2 for the next run" && [ ! -e "$2/partial" ] && [ ! -e "$FAKE_APT_CONF" ]
}
case_warm_cache() { # <scripts> : the same dir again, with a dead mirror: no update, no download
  local dir; dir=$(fresh_dir)
  case_cold_cache "$1" "$dir" || return 1
  FAKE_UPDATE=hang run "$1" "$FUSER_BIN" 0 "$dir"
  [ "$CODE" -eq 0 ] && installed && ! logged "apt-get update" && ! logged "fetched" \
    && has "installed from the cache; the mirror was not contacted"
}
case_partial_cache() { # <scripts> : the cache covers one package; only the other is fetched
  local dir; dir=$(fresh_dir); : >"$dir/fonts-unifont_1.0_all.deb"
  run "$1" "$FUSER_BIN" 0 "$dir"
  [ "$CODE" -eq 0 ] && installed && ! logged "fetched fonts-unifont" \
    && logged "apt-get install -y --download-only --no-install-recommends xfonts-utils ["
}
case_pruned_to_installed() { # <scripts> : a superseded version is dropped before the save
  local dir; dir=$(fresh_dir)
  : >"$dir/fonts-unifont_0.9_all.deb"; : >"$dir/fonts-unifont_1.0_all.deb"
  : >"$dir/xfonts-utils_1%3a1.0_all.deb"
  run "$1" "$FUSER_BIN" 0 "$dir"
  [ "$CODE" -eq 0 ] && [ ! -e "$dir/fonts-unifont_0.9_all.deb" ] && debs_in "$dir" 2 \
    && [ -e "$dir/xfonts-utils_1%3a1.0_all.deb" ] && has "dropped fonts-unifont_0.9_all.deb"
}
expect "case_cold_cache" case_cold_cache "$SUBJECT" "$(fresh_dir)"
for c in case_warm_cache case_partial_cache case_pruned_to_installed; do expect "$c" "$c" "$SUBJECT"; done
PREINSTALLED=$'fonts-unifont 1.0\nxfonts-utils 1.0\n' run "$SUBJECT" "$FUSER_BIN" 0 "$(fresh_dir)"
expect "all present: no apt-get at all" eval '[ "$CODE" -eq 0 ] && ! logged "apt-get" && count_in browsers 1'

NO_REDIRECT="$WORK/no-redirect"; subject_copy "$NO_REDIRECT"
mutate "$NO_REDIRECT/install-chromium.sh" 's/^  use_apt_archive_dir "\$APT_ARCHIVE_DIR"$/  : redirect removed/'
control "cold cache passed with the redirect removed" case_cold_cache "$NO_REDIRECT" "$(fresh_dir)"
NO_CACHE_FIRST="$WORK/no-cache-first"; subject_copy "$NO_CACHE_FIRST"
mutate "$NO_CACHE_FIRST/chromium-system-packages.sh" 's/^  if \[ "\${#debs\[@\]}" -gt 0 \]; then$/  if false; then/'
for c in case_warm_cache case_partial_cache; do
  control "$c passed with the cache-first install removed" "$c" "$NO_CACHE_FIRST"
done
NO_PRUNE="$WORK/no-prune"; subject_copy "$NO_PRUNE"
mutate "$NO_PRUNE/apt-archive-cache.sh" 's/^  prune_to_installed "\$apt_archive_dir"$/  : prune removed/'
control "pruning passed with the prune removed" case_pruned_to_installed "$NO_PRUNE"

report install-chromium.test.sh \
  "including controls on the wait, the archive redirect, the cache-first install and the prune"
