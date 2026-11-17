#!/usr/bin/env bash
# Install Playwright's Chromium and its system packages: the only `playwright install` in CI.
#
# Every workflow step that needs a browser runs this (scripts/check-browser-installs-use-the-
# script.mjs refuses an inline install). Run it from a directory whose node_modules holds the
# LOCKED playwright, after `npm ci`: npx resolves the version from there, and an npx that finds
# none fetches the latest, whose browser build the locked tests then cannot find.
#
# Two failures, two different answers:
#
#   A held apt/dpkg lock. `--with-deps` shells out to apt-get, which fails at once (exit 100)
#   when another apt-get holds /var/lib/dpkg/lock-frontend. Retrying into a held lock fails
#   identically, so before EVERY attempt this waits until the locks are free
#   (wait-for-apt-locks.sh). UI run 39831695758 ("UI sweep geometry", 2026-10-22) is the case:
#   attempt 1 was still downloading fonts from a slow mirror when its 300s bound expired;
#   `timeout` ended npx but not the root apt-get under it, which kept the lock, and attempts
#   2 and 3 died on "held by process 2787 (apt-get)" -- the first attempt's own apt-get.
#
#   A stalled download. The browser fetch has no timeout of its own: `test:notifications`
#   spent 55 minutes in it (parent run 33300992291). Each attempt is bounded, and only that
#   case is what the retry is for.
#
#   A slow mirror. The apt half fetched 21.1 MB at ~40 KB/s on 2026-10-22, and a 15-minute job
#   ran out inside it (UI run 39843446695). apt now downloads into <apt-archive-dir>, which the
#   install-chromium action restores from and saves to the Actions cache (apt-archive-cache.sh
#   has the detail); a warm cache downloads nothing, so the mirror's speed stops mattering.
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
# SIGKILL this long after the SIGTERM, so an npx that ignores the TERM cannot hold the step.
readonly KILL_GRACE_SECONDS=30
# Pause before attempt n is n * this; the lock wait, not this pause, is what covers apt.
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
# shellcheck source-path=SCRIPTDIR source=wait-for-apt-locks.sh
. "$here/wait-for-apt-locks.sh"
# shellcheck source-path=SCRIPTDIR source=apt-archive-cache.sh
. "$here/apt-archive-cache.sh"

why_it_failed() {
  case "$1" in
    124|137) echo "timed out after ${ATTEMPT_TIMEOUT_SECONDS}s (a stalled or slow download)." \
      "An apt-get it started can outlive the timeout and keep the dpkg lock;" \
      "the next attempt waits for that lock instead of failing on it" ;;
    100) echo "apt-get failed (exit 100) -- usually a lock taken between the wait and the" \
      "install; the next attempt waits for it again" ;;
    *) echo "exit $1" ;;
  esac
}

if command -v apt-get >/dev/null 2>&1; then
  trap release_apt_archive_dir EXIT
  use_apt_archive_dir "$APT_ARCHIVE_DIR"
else
  echo "no apt-get here: '$APT_ARCHIVE_DIR' is unused, and --with-deps installs no packages"
fi

attempt=1
while :; do
  wait_for_apt_locks
  echo "installing Chromium with its system packages (attempt $attempt/$ATTEMPTS)"
  status=0
  timeout --kill-after="$KILL_GRACE_SECONDS" "$ATTEMPT_TIMEOUT_SECONDS" \
    npx playwright install --with-deps chromium || status=$?
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
