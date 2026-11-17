#!/usr/bin/env bash
# Wait until no process holds apt's or dpkg's locks, for at most LOCK_WAIT_CAP_SECONDS.
#
# The one wait every CI step that drives apt-get goes through, run directly or sourced by
# install-chromium.sh. It used to be a `wait_for_apt_lock` function pasted into six workflow
# steps; three more steps had none, and the copies had drifted (300s vs 600s, different text).
#
# Why a wait and not a retry: a held lock fails apt-get at once with exit 100 --
#   E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 2787 (apt-get)
# -- so retrying into it fails identically (UI run 39831695758, "UI sweep geometry", twice).
# The condition that matters is "the lock is free", and this waits for exactly that.
#
# Who holds it: the runner image's apt-daily / unattended-upgrades after boot, and -- the case
# seen on 2026-10-22 -- an apt-get started by an earlier `playwright install --with-deps` that
# `timeout` gave up on. `timeout` signals its own process group; sudo does not relay a signal
# sent from inside that group, so the root apt-get outlives the attempt and keeps the lock.
#
# Usage: wait-for-apt-locks.sh   (no arguments; the constants below are the only knobs)
# Exits non-zero only when it cannot tell whether a lock is held. When the cap passes with a
# lock still held it says so and returns 0: apt then names the holder in its own error.
set -euo pipefail

readonly LOCK_WAIT_CAP_SECONDS=600
readonly LOCK_POLL_SECONDS=5
# Every lock apt-get takes: `apt-get update` takes the lists lock, `install` the other three.
readonly APT_LOCK_FILES=(
  /var/lib/dpkg/lock-frontend
  /var/lib/dpkg/lock
  /var/lib/apt/lists/lock
  /var/cache/apt/archives/lock
)
# The fallback when fuser (psmisc) is absent. pgrep matches the 15-character comm name.
readonly APT_PROCESS_PATTERN='apt|apt-get|dpkg|unattended-upgr'

# Which probe answers "is a lock held?". Decided once, in this shell: a failure inside the
# $(...) below would only end that subshell, and its non-zero status would read as "free".
apt_lock_probe() {
  if command -v fuser >/dev/null 2>&1; then echo fuser; return; fi
  if command -v pgrep >/dev/null 2>&1; then echo pgrep; return; fi
  echo "::error::wait-for-apt-locks: neither fuser nor pgrep is on PATH, so whether apt's" \
    "locks are held cannot be told. Install psmisc or procps." >&2
  exit 2
}

# Prints the holding PIDs and returns 0 while any lock is held; returns 1 when all are free.
apt_lock_holders() {
  case "$1" in
    # One file per call: fuser exits 0 when the file is open (PIDs to stdout, names to
    # stderr), and a lock file that does not exist then reads as free rather than as an error
    # that could hide the others.
    fuser)
      local f held=1
      for f in "${APT_LOCK_FILES[@]}"; do
        if sudo fuser "$f" 2>/dev/null; then held=0; fi
      done
      return "$held" ;;
    pgrep) pgrep -x -d ' ' "$APT_PROCESS_PATTERN" ;;
  esac
}

wait_for_apt_locks() {
  local probe waited=0 holders
  probe=$(apt_lock_probe) || exit 2
  while holders=$(apt_lock_holders "$probe"); do
    # Unquoted on purpose: fuser pads its PIDs, and this collapses them to single spaces.
    # shellcheck disable=SC2086,SC2116
    holders=$(echo $holders)
    if [ "$waited" -ge "$LOCK_WAIT_CAP_SECONDS" ]; then
      echo "::warning::apt lock still held after ${LOCK_WAIT_CAP_SECONDS}s by PID(s) ${holders};" \
        "proceeding anyway -- apt-get will fail on it and name the holder"
      return 0
    fi
    echo "waiting for apt's locks (${probe}): held by PID(s) ${holders}," \
      "${waited}s of ${LOCK_WAIT_CAP_SECONDS}s"
    sleep "$LOCK_POLL_SECONDS"
    waited=$((waited + LOCK_POLL_SECONDS))
  done
  if [ "$waited" -gt 0 ]; then
    echo "apt's locks are free after ${waited}s"
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if [ "$#" -ne 0 ]; then
    echo "usage: wait-for-apt-locks.sh (no arguments; its constants are the configuration)" >&2
    exit 64
  fi
  wait_for_apt_locks
fi
