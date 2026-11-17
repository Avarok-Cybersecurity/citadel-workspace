#!/usr/bin/env bash
# Tests for install-chromium.sh and wait-for-apt-locks.sh, with no root and no network.
#
# The scripts run under `env -i PATH=<fakes>`: fuser, sudo, pgrep, npx, timeout and sleep are
# stand-ins sharing a fake clock (sleep advances it). The fake dpkg lock is held until a set
# time; npx run while it is held fails with apt's exit 100, as the real one did on 2026-10-22,
# and a fake npx that "times out" can leave its apt-get holding the lock, as that one did.
#
# Each lock case is then run again against a copy with the wait removed, and must FAIL there:
# a case that passes either way is not testing the wait.
#
# The apt-archive cases run against a copy whose apt.conf path points into the scratch dir
# (the real one is /etc/apt/apt.conf.d), with a fake npx that "downloads" each package into
# whatever Dir::Cache::Archives says. A cold run must leave the packages in the cached dir and
# a warm one must download none; both are run again with the redirect removed and must FAIL.
#
# Usage: bash scripts/ci/install-chromium.test.sh
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
BASH_BIN=$(command -v bash)

make_fakes() { # <dir> <with-fuser:yes|no> <with-pgrep:yes|no>
  local bin=$1
  mkdir -p "$bin"
  cat >"$bin/sudo" <<'EOF'
#!/bin/bash
exec "$@"
EOF
  cat >"$bin/sleep" <<'EOF'
#!/bin/bash
read -r clock <"$STATE/clock"; echo $((clock + $1)) >"$STATE/clock"; echo "sleep $1" >>"$STATE/log"
EOF
  cat >"$bin/timeout" <<'EOF'
#!/bin/bash
while [ "${1#--}" != "$1" ]; do shift; done
echo "timeout $1" >>"$STATE/log"; shift
exec "$@"
EOF
  local held='read -r clock <"$STATE/clock"; read -r rel <"$STATE/release_at"
locked() { [ "$rel" -lt 0 ] || [ "$clock" -lt "$rel" ]; }'
  if [ "$2" = yes ]; then
    printf '#!/bin/bash\n%s\necho "fuser $*" >>"$STATE/probes"\nif locked; then echo " 2787"; exit 0; fi\nexit 1\n' "$held" >"$bin/fuser"
  fi
  if [ "$3" = yes ]; then
    printf '#!/bin/bash\n%s\necho "pgrep $*" >>"$STATE/probes"\nif locked; then echo 2787; exit 0; fi\nexit 1\n' "$held" >"$bin/pgrep"
  fi
  printf '#!/bin/bash\n%s\n' "$held" >"$bin/npx"
  cat >>"$bin/npx" <<'EOF'
read -r n <"$STATE/npx_calls"; n=$((n + 1)); echo "$n" >"$STATE/npx_calls"
if locked; then
  echo "npx LOCKED at ${clock}s" >>"$STATE/log"
  echo "E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 2787 (apt-get)" >&2
  exit 100
fi
codes=($FAKE_NPX_CODES); code=${codes[$((n - 1))]:-0}
echo "npx free at ${clock}s -> $code ($*)" >>"$STATE/log"
if [ "$code" = 0 ] && [ -n "${FAKE_APT_CONF:-}" ]; then
  dir=$STATE/system-archives  # where apt would download without the redirect
  [ -f "$FAKE_APT_CONF" ] && dir=$(sed -n 's/^Dir::Cache::Archives "\(.*\)\/";$/\1/p' "$FAKE_APT_CONF")
  mkdir -p "$dir/partial"; : >"$dir/lock"; : >"$dir/partial/inflight"
  for pkg in $FAKE_PKGS; do
    [ -f "$dir/$pkg.deb" ] || { : >"$dir/$pkg.deb"; echo "fetched $pkg into $dir" >>"$STATE/log"; }
  done
fi
if [ "$code" = 124 ] && [ -n "${FAKE_ORPHAN_SECONDS:-}" ]; then
  echo $((clock + FAKE_ORPHAN_SECONDS)) >"$STATE/release_at"
fi
exit "$code"
EOF
  chmod +x "$bin"/*
}

# run <scripts-dir> <bin> <release_at> <npx codes> [orphan seconds] -> sets OUT, CODE, STATE
run() {
  STATE=$(mktemp -d "$WORK/state.XXXX")
  echo 0 >"$STATE/clock"; echo "$3" >"$STATE/release_at"; echo 0 >"$STATE/npx_calls"
  : >"$STATE/log"; : >"$STATE/probes"
  CODE=0
  OUT=$(env -i PATH="$2" STATE="$STATE" FAKE_NPX_CODES="$4" FAKE_ORPHAN_SECONDS="${5:-}" \
    FAKE_APT_CONF="${FAKE_APT_CONF:-}" FAKE_PKGS="${FAKE_PKGS:-}" \
    "$BASH_BIN" "$1/install-chromium.sh" "${ARGS[@]}" 2>&1) || CODE=$?
}

ARGS=("$WORK/archives-unused")
FAILS=()
expect() { # <description> <test command...>
  local what=$1; shift
  if ! "$@"; then FAILS+=("$what"); fi
}
has() { grep -qF -- "$1" <<<"$OUT"; }
logged() { grep -qF -- "$1" "$STATE/log"; }
npx_calls() { read -r n <"$STATE/npx_calls"; [ "$n" -eq "$1" ]; }
never_locked() { ! logged "npx LOCKED"; }

case_lock_released() { # held for 20s, then free: waits, then installs once
  run "$1" "$2" 20 "0"
  [ "$CODE" -eq 0 ] && npx_calls 1 && never_locked && has "apt's locks are free after 20s"
}
case_lock_never_released() { # the cap passes: it says so, then proceeds into apt
  run "$1" "$2" -1 "0"
  has "apt lock still held after 600s" && logged "npx LOCKED at 600s" && [ "$CODE" -eq 1 ]
}
case_orphan_then_three_failures() { # attempt 1 times out, its apt-get holds the lock 50s more
  run "$1" "$2" 0 "124 1 1" 50
  [ "$CODE" -eq 1 ] && npx_calls 3 && never_locked && has "failed 3 times" \
    && has "timed out after 600s"
}
case_orphan_then_success() { # today's run, recovered: timed out, waited for its lock, installed
  run "$1" "$2" 0 "124 0" 50
  [ "$CODE" -eq 0 ] && npx_calls 2 && never_locked
}
LOCK_CASES=(case_lock_released case_lock_never_released case_orphan_then_three_failures case_orphan_then_success)

FUSER_BIN="$WORK/bin-fuser"; make_fakes "$FUSER_BIN" yes yes
PGREP_BIN="$WORK/bin-pgrep"; make_fakes "$PGREP_BIN" no yes
BARE_BIN="$WORK/bin-bare"; make_fakes "$BARE_BIN" no no

for c in "${LOCK_CASES[@]}"; do
  expect "$c (fuser)" "$c" "$HERE" "$FUSER_BIN"
  expect "$c probes with fuser" grep -q "^fuser /var/lib/dpkg/lock-frontend" "$STATE/probes"
done
expect "case_lock_released (pgrep fallback)" case_lock_released "$HERE" "$PGREP_BIN"
expect "pgrep fallback probes apt by name" grep -q "^pgrep -x" "$STATE/probes"

run "$HERE" "$BARE_BIN" 0 "0"
expect "no probe at all: refuses, exit 2, before any install" \
  eval '[ "$CODE" -eq 2 ] && has "neither fuser nor pgrep" && npx_calls 0'

run "$HERE" "$FUSER_BIN" 0 "0"
expect "lock free: installs at once, without waiting" eval 'npx_calls 1 && ! has "waiting for"'

# The control: the same lock cases against a copy whose wait is gone.
MUTANT="$WORK/mutant"; mkdir "$MUTANT"; cp "$HERE"/*.sh "$MUTANT/"
sed -i.orig 's/^  wait_for_apt_locks$/  : wait removed/' "$MUTANT/install-chromium.sh"
if cmp -s "$MUTANT/install-chromium.sh" "$MUTANT/install-chromium.sh.orig"; then
  FAILS+=("control did not apply: no '  wait_for_apt_locks' line in install-chromium.sh")
fi
for c in "${LOCK_CASES[@]}"; do
  if "$c" "$MUTANT" "$FUSER_BIN"; then FAILS+=("control: $c passed with the wait removed"); fi
done

# --- apt archives: <apt-archive-dir> is where apt downloads, and it is left for the cache to save.
ARGS=()
run "$HERE" "$FUSER_BIN" 0 "0"
expect "no archive dir: usage, exit 64, before any install" eval '[ "$CODE" -eq 64 ] && npx_calls 0'

APT_BIN="$WORK/bin-apt"; make_fakes "$APT_BIN" yes yes
for tool in mkdir rm chown id tee sed cat; do ln -s "$(command -v "$tool")" "$APT_BIN/$tool"; done
printf '#!/bin/bash\necho "apt-get must not be run directly" >&2; exit 99\n' >"$APT_BIN/apt-get"
chmod +x "$APT_BIN/apt-get"
export FAKE_APT_CONF="$WORK/apt.conf.d/99citadel-chromium-archives" FAKE_PKGS="fonts-unifont xfonts-utils"
mkdir -p "$WORK/apt.conf.d"
apt_copy() { # <dir> : the scripts, with the apt.conf path moved into the scratch dir
  mkdir -p "$1"; cp "$HERE"/*.sh "$1/"
  sed -i.orig "s|^readonly APT_ARCHIVE_CONF=/etc/apt/apt.conf.d/|readonly APT_ARCHIVE_CONF=$WORK/apt.conf.d/|" \
    "$1/apt-archive-cache.sh"
  if cmp -s "$1/apt-archive-cache.sh" "$1/apt-archive-cache.sh.orig"; then
    FAILS+=("apt copy did not apply: no APT_ARCHIVE_CONF=/etc/apt/apt.conf.d/ line in apt-archive-cache.sh")
  fi
}
debs_in() { local d=("$1"/*.deb); [ -e "${d[0]}" ] && [ "${#d[@]}" -eq "$2" ]; }
case_cold_cache() { # <scripts> : a fresh, empty dir ends holding both packages, owned and tidy
  local dir
  dir=$(mktemp -d "$WORK/archives.XXXX")
  ARGS=("$dir")
  run "$1" "$APT_BIN" 0 "0"
  [ "$CODE" -eq 0 ] && debs_in "$dir" 2 && has "0 cached package(s) restored" \
    && has "2 package(s) in $dir for the next run" && [ ! -e "$dir/partial" ] \
    && [ ! -e "$dir/lock" ] && [ ! -e "$FAKE_APT_CONF" ]
}
case_warm_cache() { # <scripts> : the same dir again downloads nothing
  case_cold_cache "$1" || return 1
  run "$1" "$APT_BIN" 0 "0"
  [ "$CODE" -eq 0 ] && ! logged "fetched" && has "2 cached package(s) restored"
}
APT_CASES=(case_cold_cache case_warm_cache)
apt_copy "$WORK/apt"
for c in "${APT_CASES[@]}"; do expect "$c" "$c" "$WORK/apt"; done
ARGS=(relative/dir)
run "$WORK/apt" "$APT_BIN" 0 "0"
expect "relative archive dir: refused, exit 2, before any install" \
  eval '[ "$CODE" -eq 2 ] && has "must be absolute" && npx_calls 0'

# The control: the same apt cases against a copy that never redirects apt.
apt_copy "$WORK/apt-mutant"
sed -i.orig2 's/^  use_apt_archive_dir "\$APT_ARCHIVE_DIR"$/  : redirect removed/' "$WORK/apt-mutant/install-chromium.sh"
if cmp -s "$WORK/apt-mutant/install-chromium.sh" "$WORK/apt-mutant/install-chromium.sh.orig2"; then
  FAILS+=("control did not apply: no '  use_apt_archive_dir \"\$APT_ARCHIVE_DIR\"' line in install-chromium.sh")
fi
for c in "${APT_CASES[@]}"; do
  if "$c" "$WORK/apt-mutant"; then FAILS+=("control: $c passed with the redirect removed"); fi
done

total=$(( ${#LOCK_CASES[@]} * 2 + 4 + ${#LOCK_CASES[@]} + 1 + ${#APT_CASES[@]} + 1 + ${#APT_CASES[@]} ))
if [ "${#FAILS[@]}" -gt 0 ]; then
  printf 'FAIL: %s\n' "${FAILS[@]}" >&2
  echo "install-chromium.test.sh: ${#FAILS[@]} of $total check(s) failed" >&2
  exit 1
fi
echo "install-chromium.test.sh: $total checks passed, including ${#LOCK_CASES[@]} lock cases" \
  "that fail with the wait removed and ${#APT_CASES[@]} apt-archive cases that fail without the redirect"
