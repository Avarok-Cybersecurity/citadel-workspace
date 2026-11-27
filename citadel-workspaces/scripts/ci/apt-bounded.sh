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
# Every apt-get here reads only the Ubuntu archive. Release PR #303's run 45915480397 (musl
# leg, 2026-11-27) fetched the whole archive from the mirror, then exited 100 on a source CI
# never installs from: packages.microsoft.com answered 403, "is no longer signed". The runner's
# Ubuntu sources are the files whose every URI is its mirror list, UBUNTU_MIRROR_URI; they are
# copied into a directory of their own and apt-get is pointed at it, so a broken third-party
# source is never read. The --no-download step reads the same copy, so it resolves what the
# download fetched. No such file is an error naming the files read, not a fall back to all of
# them. List-Cleanup=false keeps the other sources' lists, which `update` would otherwise delete.
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
readonly APT_SOURCE_LIST=/etc/apt/sources.list
readonly APT_SOURCE_PARTS=/etc/apt/sources.list.d
readonly UBUNTU_MIRROR_URI=mirror+file:/etc/apt/apt-mirrors.txt

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

source_uris() { # <source file> -> prints the URIs it names, one-line (.list) or deb822 (.sources)
  case "$1" in
    *.sources) sed -n 's/^[Uu][Rr][Ii][Ss]:[[:space:]]*//p' "$1" ;;
    *) sed -n -E 's/^[[:space:]]*deb(-src)?[[:space:]]+(\[[^]]*\][[:space:]]+)?([^[:space:]]+).*/\3/p' "$1" ;;
  esac
}

is_ubuntu_source() { # <source file> : at least one URI, and every one is the mirror list
  local uri uris
  uris=$(source_uris "$1")
  [ -n "$uris" ] || return 1
  for uri in $uris; do [ "$uri" = "$UBUNTU_MIRROR_URI" ] || return 1; done
}

ubuntu_sources_dir() { # -> prints a new directory holding only the Ubuntu source files
  local f dir seen=() kept=()
  shopt -s nullglob
  for f in "$APT_SOURCE_LIST" "$APT_SOURCE_PARTS"/*.list "$APT_SOURCE_PARTS"/*.sources; do
    [ -f "$f" ] || continue
    seen+=("$f")
    if is_ubuntu_source "$f"; then kept+=("$f"); fi
  done
  shopt -u nullglob
  if [ "${#kept[@]}" -eq 0 ]; then
    echo "::error::no apt source names only $UBUNTU_MIRROR_URI, so the Ubuntu archive cannot be" \
      "told from third-party sources. Read: ${seen[*]:-nothing}" >&2
    return 1
  fi
  dir=$(mktemp -d)
  mkdir "$dir/parts"
  : >"$dir/sources.list"
  for f in "${kept[@]}"; do cat "$f" >"$dir/parts/${f##*/}"; done
  echo "apt sources: ${kept[*]} (of ${#seen[@]} read)" >&2
  echo "$dir"
}

apt_fetch_and_install() { # <deadline> <package>...
  local deadline=$1 dir status=0
  shift
  dir=$(ubuntu_sources_dir) || return
  local only=(-o "Dir::Etc::sourcelist=$dir/sources.list" -o "Dir::Etc::sourceparts=$dir/parts" -o APT::Get::List-Cleanup=false)
  { apt_until "$deadline" update "${only[@]}" &&
    apt_until "$deadline" install -y --download-only --no-install-recommends "${only[@]}" "$@" &&
    sudo apt-get install -y --no-download --no-install-recommends "${only[@]}" "$@"; } || status=$?
  rm -rf "$dir"
  return "$status"
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
