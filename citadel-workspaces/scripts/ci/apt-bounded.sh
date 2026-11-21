#!/usr/bin/env bash
# apt-get against the mirror, under a deadline that really ends it: the one way CI installs
# Ubuntu packages from the network. Sourced by install-chromium.sh; run directly by the
# build-agent action for musl-tools.
#
# Publish Images run 44530131940 (test:notifications, 2026-11-19) lost 30 minutes to two
# defects here:
#
#   The deadline sat ABOVE sudo. `timeout 600 npx playwright install --with-deps` reached
#   `sudo -- sh -c "apt-get update && ..."`. Ubuntu's sudoers sets `use_pty`, so sudo runs
#   apt-get in a session of its own, and sudo does not relay a signal sent from the process group
#   it was started in -- timeout's. The TERM never reached apt-get; `--kill-after`'s SIGKILL
#   ended sudo, not apt-get. PID 2677 kept /var/lib/apt/lists/lock, and attempts 2 and 3 each
#   waited 600 s for it, then failed on it. Here the deadline runs UNDER sudo
#   (`sudo timeout ... apt-get`): timeout is root, apt-get and everything it starts are in
#   timeout's process group, and the group kill reaches all of them.
#
#   A mirror that does not answer held apt-get for the whole attempt. The image's mirror list
#   (/etc/apt/apt-mirrors.txt; the log's 144 B is exactly azure.archive over http, then
#   archive.ubuntu.com and security.ubuntu.com over https) already fails over per file -- in
#   that log item 2 went azure, archive, then security answered -- but apt waits out a silent connection for
#   Acquire::http::Timeout (120 s unless set) before moving on. APT_CONNECTION_TIMEOUT_SECONDS
#   moves it on sooner. It is an idle bound, so a slow mirror that is still sending is kept.
#
# dpkg never runs under the deadline. The bounded steps are `update` and
# `install --download-only`, which write only the lists and the archive dir and are safe to kill
# anywhere. The step that runs dpkg is `install --no-download`: local files only, so it cannot
# stall on a mirror, and it is never killed mid-configure.
#
# Usage, run directly: apt-bounded.sh <seconds> <package>...
#   Waits for apt's locks, then fetches and installs <package>... within <seconds>.
set -euo pipefail

readonly APT_CONNECTION_TIMEOUT_SECONDS=30
# SIGKILL this long after the deadline's SIGTERM, for a process that ignores the TERM.
readonly KILL_GRACE_SECONDS=30
readonly APT_NETWORK_OPTIONS=(
  -o "Acquire::http::Timeout=$APT_CONNECTION_TIMEOUT_SECONDS"
  -o "Acquire::https::Timeout=$APT_CONNECTION_TIMEOUT_SECONDS"
)

apt_bounded_here=${BASH_SOURCE[0]%/*}
[ "$apt_bounded_here" = "${BASH_SOURCE[0]}" ] && apt_bounded_here=.
# shellcheck source-path=SCRIPTDIR source=wait-for-apt-locks.sh
. "$apt_bounded_here/wait-for-apt-locks.sh"

seconds_until() { # <deadline, in $SECONDS> -> prints what is left; returns 1 when nothing is
  local left=$(($1 - SECONDS))
  echo "$left"
  [ "$left" -gt 0 ]
}

# A kill that left a lock holder behind is the defect this file exists to prevent, so it ends
# the run here, naming the holder, rather than letting the next attempt wait 600 s on it.
locks_free_after_kill() { # <what was killed>
  local probe holders
  probe=$(apt_lock_probe) || exit 2
  if holders=$(apt_lock_holders "$probe"); then
    # shellcheck disable=SC2086,SC2116
    echo "::error::$1 was killed at its deadline, yet PID(s) $(echo $holders) still hold apt's" \
      "locks: something it started escaped the kill" >&2
    exit 1
  fi
  echo "$1: killed at its deadline; apt's locks are free"
}

apt_until() { # <deadline> <apt-get arguments...> : one network apt-get, as root, bounded
  local deadline=$1 left status=0
  shift
  left=$(seconds_until "$deadline") || { echo "apt-get $1: no time left before the deadline"; return 124; }
  sudo timeout --kill-after="$KILL_GRACE_SECONDS" "$left" \
    apt-get "${APT_NETWORK_OPTIONS[@]}" "$@" || status=$?
  case "$status" in 124|137) locks_free_after_kill "apt-get $1" ;; esac
  return "$status"
}

apt_fetch_and_install() { # <deadline> <package>...
  local deadline=$1
  shift
  apt_until "$deadline" update || return
  apt_until "$deadline" install -y --download-only --no-install-recommends "$@" || return
  sudo apt-get install -y --no-download --no-install-recommends "$@"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if [ "$#" -lt 2 ] || ! [[ "$1" =~ ^[1-9][0-9]*$ ]]; then
    echo "usage: apt-bounded.sh <seconds> <package>..." >&2
    exit 64
  fi
  budget=$1
  shift
  wait_for_apt_locks
  apt_fetch_and_install $((SECONDS + budget)) "$@"
fi
