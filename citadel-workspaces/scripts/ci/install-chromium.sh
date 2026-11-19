#!/usr/bin/env bash
# Install Playwright's Chromium and its system packages: the only `playwright install` in CI.
#
# Every workflow step that needs a browser runs this (scripts/check-browser-installs-use-the-
# script.mjs refuses an inline install). Run it from a directory whose node_modules holds the
# LOCKED playwright, after `npm ci`: npx resolves the version from there, and an npx that finds
# none fetches the latest, whose browser build the locked tests then cannot find.
#
# What each failure gets:
#
#   A held apt/dpkg lock. apt-get fails at once (exit 100) on it, so before EVERY attempt this
#   waits until the locks are free (wait-for-apt-locks.sh) -- for the runner's own apt.
#
#   Our own attempt's apt-get outliving its timeout (UI run 39831695758 on 2026-10-22; Publish
#   Images run 44530131940 on 2026-11-19, PID 2677, 30 minutes). The deadline used to sit above
#   sudo, which does not pass it on; it now runs under sudo and kills apt-get's whole process
#   group, and a kill that leaves a lock holder ends the run naming it (apt-bounded.sh).
#
#   A mirror that does not answer. The system packages come from the cached archives with no
#   `apt-get update` at all when they cover Playwright's list (chromium-system-packages.sh);
#   only what is missing goes to the mirror, with a per-connection timeout (apt-bounded.sh).
#
#   A stalled browser download. Playwright's fetch has no timeout of its own:
#   `test:notifications` once spent 55 minutes in it (parent run 33300992291). It runs as the
#   runner user with nothing under sudo, so `timeout` reaches all of it.
#
#   A slow mirror. The packages and the browser are restored from the Actions cache
#   (apt-archive-cache.sh), so a warm cache downloads nothing.
#
# Each attempt has one deadline for all of its network steps. After any failure the next
# attempt starts clean -- no process of the last one survives it -- which is what makes it
# a second attempt rather than a wait on the first.
#
# Usage: install-chromium.sh <apt-archive-dir>
#   <apt-archive-dir>: absolute; where apt keeps the packages it downloads. Called only by
#   .github/actions/install-chromium, which caches it. Unused where there is no apt (macOS).
# Exits 0 once installed; non-zero, saying why, after ATTEMPTS failures.
set -euo pipefail

readonly ATTEMPTS=3
# Ten minutes per attempt: a cold Chromium + headless shell is ~170 MB, and the apt half
# measured 25.9 MB at ~40 KB/s from the Azure mirror on 2026-10-22.
readonly ATTEMPT_TIMEOUT_SECONDS=600
# Pause before attempt n is n * this.
readonly BACKOFF_STEP_SECONDS=15

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "usage: install-chromium.sh <apt-archive-dir> (the install-chromium action passes it)" >&2
  exit 64
fi
readonly APT_ARCHIVE_DIR=$1

for tool in timeout npx; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "::error::install-chromium: '$tool' is not on PATH" >&2
    exit 2
  fi
done

here=${BASH_SOURCE[0]%/*}
[ "$here" = "${BASH_SOURCE[0]}" ] && here=.
# apt-bounded.sh sources wait-for-apt-locks.sh.
# shellcheck source-path=SCRIPTDIR source=apt-bounded.sh
. "$here/apt-bounded.sh"
# shellcheck source-path=SCRIPTDIR source=apt-archive-cache.sh
. "$here/apt-archive-cache.sh"
# shellcheck source-path=SCRIPTDIR source=chromium-system-packages.sh
. "$here/chromium-system-packages.sh"

why_it_failed() {
  case "$1" in
    124|137) echo "hit its ${ATTEMPT_TIMEOUT_SECONDS}s deadline (a stalled or slow download)," \
      "and everything it started was killed with it" ;;
    100) echo "apt-get failed (exit 100)" ;;
    *) echo "exit $1" ;;
  esac
}

packages=()
if command -v apt-get >/dev/null 2>&1; then
  trap release_apt_archive_dir EXIT
  use_apt_archive_dir "$APT_ARCHIVE_DIR"
  list=$(playwright_system_packages) || exit 2
  read -r -a packages <<<"$list"
  echo "system packages Playwright needs for Chromium: ${#packages[@]}"
else
  echo "no apt-get here: '$APT_ARCHIVE_DIR' is unused, and no system packages are installed"
fi

browser_until() { # <deadline> : the browser download, as the runner user, bounded
  local left
  left=$(seconds_until "$1") || return 124
  timeout --kill-after="$KILL_GRACE_SECONDS" "$left" npx playwright install chromium
}

attempt=1
while :; do
  wait_for_apt_locks
  echo "installing Chromium with its system packages (attempt $attempt/$ATTEMPTS)"
  deadline=$((SECONDS + ATTEMPT_TIMEOUT_SECONDS))
  status=0
  if [ "${#packages[@]}" -gt 0 ]; then
    ensure_chromium_system_packages "$deadline" "$APT_ARCHIVE_DIR" "${packages[@]}" || status=$?
  fi
  if [ "$status" -eq 0 ]; then
    browser_until "$deadline" || status=$?
  fi
  if [ "$status" -eq 0 ]; then
    echo "Chromium installed (attempt $attempt/$ATTEMPTS)"
    exit 0
  fi
  reason=$(why_it_failed "$status")
  if [ "$attempt" -ge "$ATTEMPTS" ]; then
    echo "::error::playwright install failed $ATTEMPTS times; the last: $reason"
    exit 1
  fi
  attempt=$((attempt + 1))
  echo "playwright install attempt $((attempt - 1))/$ATTEMPTS failed: $reason." \
    "Retrying in $((attempt * BACKOFF_STEP_SECONDS))s"
  sleep $((attempt * BACKOFF_STEP_SECONDS))
done
