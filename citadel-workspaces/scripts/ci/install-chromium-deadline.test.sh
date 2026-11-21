#!/usr/bin/env bash
# Tests that an attempt's deadline ends everything the attempt started, so the next one finds
# apt's locks free -- the defect behind Publish Images run 44530131940, where attempt 1's
# apt-get (PID 2677) outlived its timeout on a mirror that never answered and attempts 2 and 3
# waited 600 s each for its lock. The stand-ins are install-chromium.fakes.sh: its sudo models
# Ubuntu's `use_pty`, and its apt-get `update` can hang holding the lock, as that one did.
#
# Real processes and the real GNU timeout, with the deadline shortened to TEST_DEADLINE_SECONDS.
# Each case is run again against a mutant with its mechanism removed and must FAIL there; the
# first is the old order, the deadline above sudo rather than under it.
#
# Usage: bash scripts/ci/install-chromium-deadline.test.sh
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=install-chromium.fakes.sh
. "$(dirname "${BASH_SOURCE[0]}")/install-chromium.fakes.sh"

SUBJECT="$WORK/subject"; subject_copy "$SUBJECT"
BIN="$WORK/bin"; make_fakes "$BIN" yes yes
cut_short() { local pid; pid=$(cat "$STATE/hung.pid") && ! kill -0 "$pid" 2>/dev/null \
  && [ ! -e "$STATE/hang-completed" ]; }
# A control's survivor is stopped at once rather than left to end its hang by itself.
cleanup_survivors() { kill -9 -- "-$(cat "$STATE/hung.pid")" 2>/dev/null || true; }

case_dead_mirror() { # <scripts> : update hangs on attempt 1; the kill frees the lock; attempt 2 installs
  FAKE_UPDATE="hang ok" run "$1" "$BIN" 0 "$(mktemp -d "$WORK/archives.XXXX")"
  [ "$CODE" -eq 0 ] && installed && count_in updates 2 && cut_short \
    && has "apt-get update: killed at its deadline; apt's locks are free" \
    && has "attempt 1/3 failed: hit its" && ! has "waiting for apt's locks" && never_locked \
    && has "Chromium installed (attempt 2/3)"
}
case_bounded_connections() { # <scripts> : every network apt-get carries the per-connection timeout
  run "$1" "$BIN" 0 "$(mktemp -d "$WORK/archives.XXXX")"
  local t='[Acquire::http::Timeout=30 Acquire::https::Timeout=30]'
  [ "$CODE" -eq 0 ] && logged "apt-get update $t" && logged "apt-get install -y --download-only" \
    && grep -q -- "--download-only .* $t" "$STATE/log"
}
case_hung_browser() { # <scripts> : the browser download is bounded too, and attempt 2 installs it
  FAKE_BROWSER="hang 0" run "$1" "$BIN" 0 "$(mktemp -d "$WORK/archives.XXXX")"
  [ "$CODE" -eq 0 ] && count_in browsers 2 && cut_short && has "Chromium installed (attempt 2/3)"
}
case_survivor_ends_the_run() { # <scripts> : a lock holder the kill missed fails at once, named
  FAKE_UPDATE="hang ok" run "$1" "$BIN" 0 "$(mktemp -d "$WORK/archives.XXXX")"
  [ "$CODE" -eq 1 ] && has "still hold apt's locks" && count_in updates 1 && ! has "attempt 2/3"
}

# apt-bounded.sh run directly, as the build-agent action installs musl-tools: one attempt, so
# a mirror that never answers fails the step at its deadline, with nothing left holding a lock.
case_direct_dead_mirror() { # <scripts>
  FAKE_UPDATE=hang run_script "$1/apt-bounded.sh" "$BIN" 0 "$TEST_DEADLINE_SECONDS" musl-tools
  [ "$CODE" -eq 124 ] && cut_short && has "apt-get update: killed at its deadline; apt's locks are free" \
    && ! logged "apt-get install"
}
case_direct_installs() { # <scripts>
  FAKE_PKGS=musl-tools run_script "$1/apt-bounded.sh" "$BIN" 0 "$TEST_DEADLINE_SECONDS" musl-tools
  [ "$CODE" -eq 0 ] && grep -q "^musl-tools " "$STATE/installed" && logged "apt-get update [Acquire"
}
expect "case_direct_dead_mirror" case_direct_dead_mirror "$SUBJECT"
expect "case_direct_installs" case_direct_installs "$SUBJECT"
run_script "$SUBJECT/apt-bounded.sh" "$BIN" 0 musl-tools
expect "apt-bounded.sh with no budget: usage, exit 64, no apt-get" eval '[ "$CODE" -eq 64 ] && ! logged "apt-get"'

expect "case_dead_mirror" case_dead_mirror "$SUBJECT"
expect "case_bounded_connections" case_bounded_connections "$SUBJECT"
expect "case_hung_browser" case_hung_browser "$SUBJECT"

# The old order: the deadline above sudo, which neither relays its TERM nor survives its KILL.
ABOVE_SUDO="$WORK/above-sudo"; subject_copy "$ABOVE_SUDO"
mutate "$ABOVE_SUDO/apt-bounded.sh" \
  's/^  sudo timeout --kill-after="\$KILL_GRACE_SECONDS" "\$left" \\$/  timeout --kill-after="$KILL_GRACE_SECONDS" "$left" sudo \\/'
control "case_dead_mirror passed with the deadline above sudo" case_dead_mirror "$ABOVE_SUDO"
cleanup_survivors
control "case_direct_dead_mirror passed with the deadline above sudo" case_direct_dead_mirror "$ABOVE_SUDO"
cleanup_survivors
expect "the deadline above sudo leaves a holder, and the run names it at once" \
  case_survivor_ends_the_run "$ABOVE_SUDO"
cleanup_survivors

# The check after a kill, removed from the old order: the holder is then waited on, 600 s a
# time, as in the failed run.
NO_CHECK="$WORK/no-check"; subject_copy "$NO_CHECK"
cp "$ABOVE_SUDO/apt-bounded.sh" "$NO_CHECK/apt-bounded.sh"
mutate "$NO_CHECK/apt-bounded.sh" 's/^  case "\$status" in 124|137) locks_free_after_kill "apt-get \$1" ;; esac$/  : check removed/'
control "case_survivor_ends_the_run passed with the post-kill check removed" \
  case_survivor_ends_the_run "$NO_CHECK"
cleanup_survivors

NO_CONNECTION_TIMEOUT="$WORK/no-connection-timeout"; subject_copy "$NO_CONNECTION_TIMEOUT"
mutate "$NO_CONNECTION_TIMEOUT/apt-bounded.sh" 's/^    apt-get "\${APT_NETWORK_OPTIONS\[@\]}" "\$@" || status=\$?$/    apt-get "$@" || status=$?/'
control "case_bounded_connections passed with no connection timeout" \
  case_bounded_connections "$NO_CONNECTION_TIMEOUT"

NO_BROWSER_DEADLINE="$WORK/no-browser-deadline"; subject_copy "$NO_BROWSER_DEADLINE"
mutate "$NO_BROWSER_DEADLINE/install-chromium.sh" \
  's/^  timeout --kill-after="\$KILL_GRACE_SECONDS" "\$left" npx playwright install chromium$/  npx playwright install chromium/'
control "case_hung_browser passed with the browser deadline removed" case_hung_browser "$NO_BROWSER_DEADLINE"

report install-chromium-deadline.test.sh \
  "including controls on the order under sudo, the post-kill check, the connection timeout and the browser deadline"
