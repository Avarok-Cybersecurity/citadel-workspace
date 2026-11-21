#!/usr/bin/env bash
# Stand-ins for the install-chromium tests: no root, no network, no apt. Sourced by
# install-chromium.test.sh and install-chromium-deadline.test.sh.
#
# The scripts run under `env -i PATH=<fakes>`. `sleep` is a fake clock (the lock wait and the
# backoff advance it, instantly); `timeout` is the real GNU one, because what is under test is
# who its kill reaches. The fakes:
#   sudo      Ubuntu's sudo with `use_pty`: the command runs in a process group of its own, and
#             a signal from the group sudo was started in is not relayed to it. A SIGKILL ends
#             sudo and leaves the command running -- PID 2677's survival, in miniature.
#   apt-get   takes "the lock" by writing its PID to $STATE/lock.pid; fails with exit 100 while
#             another live apt-get holds it or the clock is before $STATE/release_at (a foreign
#             apt). `update` follows $FAKE_UPDATE per call: ok, or hang -- a mirror that never
#             answers, which keeps the PID and so the lock. `--download-only` writes each
#             package into Dir::Cache::Archives; `--no-download` installs from there or from
#             the .deb paths given, or fails if one is not on disk.
#   dpkg-query  answers from $STATE/installed.
#   fuser, pgrep  report the foreign lock and any live apt-get holding lock.pid.
#   npx       prints `install-deps --dry-run` for $FAKE_PKGS; `install chromium` follows
#             $FAKE_BROWSER per call (an exit code, or hang); anything else is refused.

FAKES_REAL_SLEEP=$(command -v sleep)
FAKES_REAL_TIMEOUT=$(command -v timeout || command -v gtimeout || true)
if [ -z "$FAKES_REAL_TIMEOUT" ]; then
  echo "install-chromium tests: GNU timeout is not on PATH (coreutils)" >&2
  exit 2
fi
BASH_BIN=$(command -v bash)
CI_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WORK=$(mktemp -d)
cleanup_fakes() { # stops any fake that a control left running, then drops the scratch dir
  local f
  for f in "$WORK"/state.*/hung.pid; do
    [ -f "$f" ] || continue
    kill -9 -- "-$(cat "$f")" 2>/dev/null || kill -9 "$(cat "$f")" 2>/dev/null || true
  done
  rm -rf "$WORK"
}
trap cleanup_fakes EXIT

make_fakes() { # <dir> <with-fuser:yes|no> <with-pgrep:yes|no>
  local bin=$1 tool
  mkdir -p "$bin"
  ln -s "$FAKES_REAL_TIMEOUT" "$bin/timeout"
  for tool in mkdir rm chown id tee sed cat grep tail; do ln -s "$(command -v "$tool")" "$bin/$tool"; done
  printf '#!/bin/bash\ntrap : TERM INT HUP\nset -m\n"$@" &\npid=$!\n%s\n' \
    'while :; do wait "$pid"; s=$?; kill -0 "$pid" 2>/dev/null || exit "$s"; done' >"$bin/sudo"
  cat >"$bin/sleep" <<'EOF'
#!/bin/bash
read -r clock <"$STATE/clock"; echo $((clock + $1)) >"$STATE/clock"; echo "sleep $1" >>"$STATE/log"
EOF
  local holder='read -r clock <"$STATE/clock"; read -r rel <"$STATE/release_at"
foreign() { [ "$rel" -lt 0 ] || [ "$clock" -lt "$rel" ]; }
holder() { [ -f "$STATE/lock.pid" ] && kill -0 "$(cat "$STATE/lock.pid")" 2>/dev/null && cat "$STATE/lock.pid"; }'
  # A hang that is never cut short ends by itself and says so: a case that passes either way
  # is not testing the cut. It lets go of the run's output first, so that a survivor does not
  # hold the test's $(...) open until it ends.
  local hang='hang() { echo $$ >"$STATE/hung.pid"; exec >/dev/null 2>&1
"$REAL_SLEEP" "$FAKE_HANG_SECONDS"; : >"$STATE/hang-completed"; exit 1; }'
  local probe='if foreign; then echo " 2787"; exit 0; fi; if h=$(holder); then echo " $h"; exit 0; fi; exit 1'
  [ "$2" = yes ] && printf '#!/bin/bash\n%s\necho "fuser $*" >>"$STATE/probes"\n%s\n' "$holder" "$probe" >"$bin/fuser"
  [ "$3" = yes ] && printf '#!/bin/bash\n%s\necho "pgrep $*" >>"$STATE/probes"\n%s\n' "$holder" "$probe" >"$bin/pgrep"
  printf '#!/bin/bash\n%s\n%s\n' "$holder" "$hang" >"$bin/apt-get"
  cat >>"$bin/apt-get" <<'EOF'
opts=(); args=()
while [ $# -gt 0 ]; do if [ "$1" = -o ]; then opts+=("$2"); shift 2; else args+=("$1"); shift; fi; done
echo "apt-get ${args[*]} [${opts[*]}]" >>"$STATE/log"
if foreign || h=$(holder); then
  echo "apt-get LOCKED at ${clock}s" >>"$STATE/log"
  echo "E: Could not get lock /var/lib/apt/lists/lock. It is held by process ${h:-2787} (apt-get)" >&2
  exit 100
fi
echo $$ >"$STATE/lock.pid"
dir=$STATE/system-archives  # where apt would download without the redirect
[ -f "$FAKE_APT_CONF" ] && dir=$(sed -n 's/^Dir::Cache::Archives "\(.*\)\/";$/\1/p' "$FAKE_APT_CONF")
case " ${args[*]} " in
  " update ")
    read -r n <"$STATE/updates"; n=$((n + 1)); echo "$n" >"$STATE/updates"
    modes=($FAKE_UPDATE)
    if [ "${modes[$((n - 1))]:-ok}" = hang ]; then hang; fi ;;
  *" --download-only "*)
    mkdir -p "$dir"
    for a in "${args[@]}"; do
      case "$a" in install|-*) ;; *) [ -f "$dir/${a}_1.0_all.deb" ] ||
        { : >"$dir/${a}_1.0_all.deb"; echo "fetched $a into $dir" >>"$STATE/log"; } ;; esac
    done ;;
  *" --no-download "*)
    for a in "${args[@]}"; do
      case "$a" in install|-*) continue ;; */*) deb=$a ;; *) deb=$dir/${a}_1.0_all.deb ;; esac
      [ -f "$deb" ] || { echo "E: $a is not on disk and --no-download was given" >&2; rm -f "$STATE/lock.pid"; exit 100; }
      base=${deb##*/}; rest=${base#*_}; version=${rest%_*}  # dpkg records %3a as the epoch's ':'
      echo "${base%%_*} ${version//'%3a'/:}" >>"$STATE/installed"
    done ;;
esac
rm -f "$STATE/lock.pid"
EOF
  cat >"$bin/dpkg-query" <<'EOF'
#!/bin/bash
fmt=$2; pkg=$3; version=$(sed -n "s/^$pkg //p" "$STATE/installed" | tail -1)
[ -n "$version" ] || exit 1
case "$fmt" in *Status*) printf installed ;; *Version*) printf '%s' "$version" ;; esac
EOF
  printf '#!/bin/bash\n%s\n' "$hang" >"$bin/npx"
  cat >>"$bin/npx" <<'EOF'
case "$*" in
  "playwright install-deps --dry-run chromium")
    echo "sudo -- sh -c \"apt-get update&& apt-get install -y --no-install-recommends $FAKE_PKGS\"" ;;
  "playwright install chromium")
    read -r n <"$STATE/browsers"; n=$((n + 1)); echo "$n" >"$STATE/browsers"
    modes=($FAKE_BROWSER); mode=${modes[$((n - 1))]:-0}
    echo "browser install $n -> $mode" >>"$STATE/log"
    if [ "$mode" = hang ]; then hang; fi
    exit "$mode" ;;
  *) echo "npx refused: $*" >>"$STATE/log"; exit 99 ;;
esac
EOF
  chmod +x "$bin"/*
}

# run <scripts-dir> <bin> <release_at> <archive-dir> -> sets OUT, CODE, STATE
run() { run_script "$1/install-chromium.sh" "$2" "$3" "$4"; }
# run_script <script> <bin> <release_at> <argument>... : any of the scripts, run directly
# shellcheck disable=SC2034 # OUT and CODE are read by the tests that source this
run_script() {
  local script=$1 bin=$2
  STATE=$(mktemp -d "$WORK/state.XXXX")
  echo 0 >"$STATE/clock"; echo "$3" >"$STATE/release_at"
  echo 0 >"$STATE/updates"; echo 0 >"$STATE/browsers"
  : >"$STATE/log"; : >"$STATE/probes"; printf '%s' "${PREINSTALLED:-}" >"$STATE/installed"
  shift 3
  CODE=0
  OUT=$("$FAKES_REAL_TIMEOUT" -k 1 "$RUN_BOUND_SECONDS" env -i PATH="$bin" STATE="$STATE" \
    REAL_SLEEP="$FAKES_REAL_SLEEP" FAKE_HANG_SECONDS="$FAKE_HANG_SECONDS" FAKE_APT_CONF="$FAKE_APT_CONF" \
    FAKE_UPDATE="${FAKE_UPDATE:-}" FAKE_BROWSER="${FAKE_BROWSER:-}" FAKE_PKGS="$FAKE_PKGS" \
    "$BASH_BIN" "$script" "$@" 2>&1) || CODE=$?
}

FAKE_PKGS="fonts-unifont xfonts-utils"
FAKE_APT_CONF="$WORK/apt.conf.d/99citadel-chromium-archives"
mkdir -p "$WORK/apt.conf.d"
FAILS=()
CHECKS=0
expect() { # <description> <test command...> : must pass
  local what=$1; shift
  CHECKS=$((CHECKS + 1))
  if ! "$@"; then FAILS+=("$what"); fi
}
control() { # <description> <test command...> : the same case against a mutant; must FAIL
  local what=$1; shift
  CHECKS=$((CHECKS + 1))
  if "$@"; then FAILS+=("control: $what"); fi
}
has() { grep -qF -- "$1" <<<"$OUT"; }
logged() { grep -qF -- "$1" "$STATE/log"; }
never_locked() { ! logged "LOCKED"; }
count_in() { local n; read -r n <"$STATE/$1"; [ "$n" -eq "$2" ]; }
installed() { local p; for p in $FAKE_PKGS; do grep -q "^$p " "$STATE/installed" || return 1; done; }

# The scripts as they ship, but for three constants: the apt.conf path moves into the scratch
# dir, and an attempt's deadline and kill grace shrink from minutes to seconds.
subject_copy() { # <dir>
  mkdir -p "$1"; cp "$CI_DIR"/*.sh "$1/"
  mutate "$1/apt-archive-cache.sh" \
    "s|^readonly APT_ARCHIVE_CONF=/etc/apt/apt.conf.d/|readonly APT_ARCHIVE_CONF=$WORK/apt.conf.d/|"
  mutate "$1/install-chromium.sh" "s/^readonly ATTEMPT_TIMEOUT_SECONDS=600$/readonly ATTEMPT_TIMEOUT_SECONDS=$TEST_DEADLINE_SECONDS/"
  mutate "$1/apt-bounded.sh" 's/^readonly KILL_GRACE_SECONDS=30$/readonly KILL_GRACE_SECONDS=1/'
}
# Ample for the fakes, which finish in milliseconds; a hung one is killed this long into it.
readonly TEST_DEADLINE_SECONDS=5
# A hang outlasts the deadline and its grace with room to spare, then ends by itself.
readonly FAKE_HANG_SECONDS=15
# A run that hangs anyway fails here rather than holding the CI job.
readonly RUN_BOUND_SECONDS=120
mutate() { # <file> <sed expression> : applies it, and records a failure if it changed nothing
  cp "$1" "$1.before"
  sed -i.sedbak "$2" "$1"
  if cmp -s "$1" "$1.before"; then FAILS+=("control did not apply to ${1##*/}: $2"); fi
}
report() { # <test name> <summary>
  if [ "${#FAILS[@]}" -gt 0 ]; then
    printf 'FAIL: %s\n' "${FAILS[@]}" >&2
    echo "$1: ${#FAILS[@]} of $CHECKS check(s) failed" >&2
    exit 1
  fi
  echo "$1: $CHECKS checks passed, $2"
}
