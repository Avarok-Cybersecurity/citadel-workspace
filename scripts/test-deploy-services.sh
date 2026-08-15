#!/usr/bin/env bash
#
# Integration test for deploy.sh's service selection AND the restart guards.
#
# WHY THIS EXISTS RATHER THAN JUST TESTING THE SELECTOR
#
# scripts/select-deploy-services.sh is unit-tested, but that only proves the *list* is right.
# The defect this guards against lives one layer down: an unconditional
# `up -d --no-deps ui` on a deployment that has no ui service. That aborts AFTER the server
# has already been swapped to its new image - a half-applied deploy, which is the single
# outcome deploy.sh's ordering exists to prevent. A selector-only test passes happily while
# that bug is reintroduced.
#
# So this runs the REAL deploy.sh end to end against fixture compose files, with `docker`
# replaced by a recording stub on PATH, and asserts what deploy.sh actually *did*: which
# services it pulled, which it restarted, and - the point - that it never touched a service
# the compose file does not declare.
#
# The stub records every invocation to $CALLS. Nothing real is pulled, started or restarted.
#
# Usage: scripts/test-deploy-services.sh        (from the repo root)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "::error::$*"; exit 1; }
pass_count=0

# ---------------------------------------------------------------------------
# The docker stub. Answers only what deploy.sh actually asks for, and records
# every call so the assertions can inspect them.
# ---------------------------------------------------------------------------
make_stub() {
  mkdir -p "$WORK/bin"
  cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$CALLS"

# `compose -f <file> <subcommand> ...` - find the subcommand after the -f pair.
if [ "${1:-}" = "compose" ]; then
  shift
  file=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -f) file="$2"; shift 2 ;;
      --profile) shift 2 ;;
      *) break ;;
    esac
  done
  sub="${1:-}"; shift || true
  case "$sub" in
    config)
      if [ "${1:-}" = "--services" ]; then
        # Service names are the top-level keys under `services:`.
        awk '/^services:/{f=1;next} f&&/^[a-z]/{exit} f&&/^  [a-zA-Z0-9_-]+:/{gsub(/[ :]/,"");print}' "$file"
      else
        # `config --format json` - emit just what deploy.sh reads: .services[x].image
        printf '{"name":"stubproj","services":{'
        first=1
        for s in $(awk '/^services:/{f=1;next} f&&/^[a-z]/{exit} f&&/^  [a-zA-Z0-9_-]+:/{gsub(/[ :]/,"");print}' "$file"); do
          [ $first -eq 0 ] && printf ','
          printf '"%s":{"image":"ghcr.io/avarok-cybersecurity/citadel-workspace-%s:latest"}' "$s" "$s"
          first=0
        done
        printf '}}'
      fi
      ;;
    ps)
      # deploy.sh's wait_for_port reads .State/.Health from the first entry.
      printf '{"Name":"stub","State":"running","Health":"healthy"}\n'
      ;;
    pull|up|logs|down) : ;;
    *) : ;;
  esac
  exit 0
fi

# `docker ps -aq --filter label=...project=X --filter label=...service=Y` - deploy.sh's orphan
# reconciliation. $PREEXISTING lists the services a PREVIOUS deploy left containers for, so a test
# can model "full stack already running" and assert what a slimmed redeploy does about it.
if [ "${1:-}" = "ps" ]; then
  svc=""; want_service_only=0
  for a in "$@"; do
    case "$a" in
      *com.docker.compose.service=*) svc="${a##*=}" ;;
      *com.docker.compose.oneoff=False) want_service_only=1 ;;
    esac
  done
  case " ${PREEXISTING:-} " in *" $svc "*) echo "cid-$svc" ;; esac
  # A `docker compose run` container carries the same project+service labels and is only excluded
  # by oneoff=False. Emitting it whenever that filter is ABSENT is what makes the test able to
  # tell whether deploy.sh actually passes the filter.
  if [ "$want_service_only" = "0" ]; then
    case " ${PREEXISTING_ONEOFF:-} " in *" $svc "*) echo "cid-oneoff-$svc" ;; esac
  fi
  exit 0
fi

# verify-image-revisions.sh calls `docker image inspect --format ... <ref>`
if [ "${1:-}" = "image" ] && [ "${2:-}" = "inspect" ]; then
  echo "testrevision0000"
  exit 0
fi
exit 0
STUB
  chmod +x "$WORK/bin/docker"
}

# ---------------------------------------------------------------------------
# Fixtures: minimal compose files with only the services under test. Written by
# hand (not derived from the production file) so the stub's simple parser is
# sufficient and the test states its inputs explicitly.
# ---------------------------------------------------------------------------
write_fixture() { # <path> <service>...
  local path="$1"; shift
  {
    echo "services:"
    for s in "$@"; do
      echo "  $s:"
      echo "    image: ghcr.io/avarok-cybersecurity/citadel-workspace-$s:latest"
    done
  } > "$path"
}

run_deploy() { # <name> <service>...
  local name="$1"; shift
  local dir="$WORK/$name"
  mkdir -p "$dir/scripts"
  write_fixture "$dir/docker-compose.production.yml" "$@"
  cp "$REPO_ROOT/scripts/select-deploy-services.sh" "$REPO_ROOT/scripts/verify-image-revisions.sh" "$dir/scripts/"
  cp "$REPO_ROOT/deploy.sh" "$dir/deploy.sh"
  # deploy.sh requires a .env with a real master password.
  printf 'WORKSPACE_MASTER_PASSWORD=test-password-not-a-placeholder\n' > "$dir/.env"
  export CALLS="$dir/calls.txt"
  export PREEXISTING="${PREEXISTING:-}"
  export PREEXISTING_ONEOFF="${PREEXISTING_ONEOFF:-}"
  : > "$CALLS"
  # --no-pull skips step 1 (git pull); the fixture dir is deliberately not a git repo, and the
  # git step is not what is under test here.
  #
  # The status is RECORDED rather than discarded. Asserting only on the recorded docker calls
  # would let a deploy that makes every expected call and then dies in a later step pass the
  # whole suite - "it called the right things" is not the same claim as "it completed", and this
  # test exists to make the second one.
  local status=0
  ( cd "$dir" && PATH="$WORK/bin:$PATH" bash ./deploy.sh --no-pull >"$dir/out.txt" 2>&1 ) || status=$?
  echo "$status" > "$dir/status.txt"
  echo "$dir"
}

assert_succeeded() { # <dir>
  local got; got=$(cat "$1/status.txt")
  [ "$got" = "0" ] || fail "deploy.sh exited $got, expected 0. Output:
$(cat "$1/out.txt")"
}

assert_failed() { # <dir>
  local got; got=$(cat "$1/status.txt")
  [ "$got" != "0" ] || fail "deploy.sh exited 0 on a compose file it must reject (see $1/out.txt)"
}

assert_pulled() { # <dir> <expected space-separated>
  local got
  # `|| true` on each stage: a non-matching grep exits 1, which under `set -e` would abort the
  # whole run silently instead of reporting which assertion failed.
  got=$(grep -E '^compose .* pull ' "$1/calls.txt" 2>/dev/null | head -1 | sed 's/.* pull //' || true)
  [ "$got" = "$2" ] || fail "pull was [$got], expected [$2] (see $1/out.txt)"
}

assert_restarted() { # <dir> <service>...
  local dir="$1"; shift
  local got
  got=$(grep -oE 'up -d --no-deps [a-z-]+' "$dir/calls.txt" 2>/dev/null | awk '{print $NF}' | tr '\n' ' ' | sed 's/ $//' || true)
  [ "$got" = "$*" ] || fail "restarts were [$got], expected [$*] (see $dir/out.txt)"
}

assert_removed() { # <dir> <service>...
  local dir="$1"; shift
  local got
  # Every id on every `rm -f` line, not just the first: docker rm takes a list, so the whole line
  # has to be split. A ^-anchored per-id pattern silently matched only the first id and let extra
  # removals through unnoticed.
  got=$(grep -E '^rm -f ' "$dir/calls.txt" 2>/dev/null | sed 's/^rm -f //' | tr ' ' '\n' | sed 's/^cid-//' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ $//' || true)
  local want; want=$(printf '%s\n' "$@" | sort | tr '\n' ' ' | sed 's/ $//')
  [ "$got" = "$want" ] || fail "removed [$got], expected [$want] (see $dir/out.txt)"
}

assert_removed_nothing() { # <dir>
  if grep -qE '^rm -f ' "$1/calls.txt"; then
    fail "deploy.sh removed a container in a clean environment: $(grep -E '^rm -f ' "$1/calls.txt")"
  fi
}

assert_never_mentions() { # <dir> <service>
  if grep -qE "up -d --no-deps $2\b" "$1/calls.txt"; then
    fail "deploy.sh tried to restart '$2', which this compose file does not declare - that is the half-applied deploy this guard exists to prevent"
  fi
}

echo "== deploy.sh service-selection integration test =="
make_stub

# --- full stack -------------------------------------------------------------
d=$(run_deploy full server internal-service ui)
assert_succeeded "$d"
assert_pulled "$d" "server internal-service ui"
assert_restarted "$d" server internal-service ui
echo "  full        -> pulled and restarted all three"; pass_count=$((pass_count+1))

# --- server only: the documented slimmed deployment --------------------------
d=$(run_deploy server-only server)
assert_succeeded "$d"
assert_removed_nothing "$d"
assert_pulled "$d" "server"
assert_restarted "$d" server
assert_never_mentions "$d" ui
assert_never_mentions "$d" internal-service
echo "  server-only -> completed; pulled/restarted server only, never touched ui or internal-service"; pass_count=$((pass_count+1))

# --- server + ui ------------------------------------------------------------
d=$(run_deploy server-ui server ui)
assert_succeeded "$d"
assert_pulled "$d" "server ui"
assert_restarted "$d" server ui
assert_never_mentions "$d" internal-service
echo "  server-ui   -> never touched internal-service"; pass_count=$((pass_count+1))

# --- server + internal-service ----------------------------------------------
d=$(run_deploy server-is server internal-service)
assert_succeeded "$d"
assert_pulled "$d" "server internal-service"
assert_restarted "$d" server internal-service
assert_never_mentions "$d" ui
echo "  server-is   -> never touched ui"; pass_count=$((pass_count+1))

# --- slimming an EXISTING full stack down to server-only ---------------------
# The case the orphan reconciliation exists for, and the one a clean-environment test cannot see:
# `docker compose up` leaves containers for undeclared services running and merely warns. Without
# reconciliation this deploy reports success while the old ui still serves a stale image on :8080.
d=$(PREEXISTING="server internal-service ui" PREEXISTING_ONEOFF="ui" run_deploy slim-transition server)
assert_succeeded "$d"
assert_pulled "$d" "server"
assert_restarted "$d" server
# server stays: it IS this deployment. Only the dropped two are removed.
assert_removed "$d" internal-service ui
assert_never_mentions "$d" ui
assert_never_mentions "$d" internal-service
if grep -qE '^rm -f .*cid-cloudflared' "$d/calls.txt"; then
  fail "reconciliation removed the profile-gated cloudflared - that is the --remove-orphans pitfall this targeted removal exists to avoid"
fi
# A `docker compose run` job against the dropped ui shares its project+service labels. deploy.sh
# must filter it out: it is someone's migration or debugging session, not a stale service container.
if grep -qE '^rm -f .*cid-oneoff-' "$d/calls.txt"; then
  fail "reconciliation removed a 'docker compose run' one-off container: $(grep -E '^rm -f .*cid-oneoff-' "$d/calls.txt" | head -1)"
fi
echo "  slim-transition -> dropped ui and internal-service removed; server, cloudflared and one-off jobs untouched"; pass_count=$((pass_count+1))

# --- a second deploy must not run while another holds the project lock -------
# The reconciliation above can remove containers this deploy did not start, so two overlapping
# deploys whose compose files disagree could delete each other's freshly started services. The
# lock is what makes that impossible; assert it actually blocks, and - the part that matters -
# that the blocked run mutates NOTHING before giving up.
# The lock lives beside the compose file, so the directory must exist before we can take it.
# Deliberately NOT derived from TMPDIR: a lock whose path the caller's environment can change is
# one two deploys can each miss, which is the property this case exists to pin.
mkdir -p "$WORK/locked-out"
lock_file="$WORK/locked-out/.deploy.lock"
exec 8>>"$lock_file"
flock -n 8 || fail "could not acquire $lock_file to set up the concurrency test"
d=$(TMPDIR=/nonexistent-tmpdir-should-not-matter run_deploy locked-out server)
exec 8>&-   # release before the assertions, so a failure here never wedges later runs
assert_failed "$d"
grep -qi "another deploy" "$d/out.txt" \
  || fail "a deploy blocked by the lock did not say why; output was: $(head -3 "$d/out.txt")"
for verb in 'pull ' 'up -d' 'rm -f'; do
  if grep -qF "$verb" "$d/calls.txt"; then
    fail "a deploy that could not take the lock still ran '$verb' - it must mutate nothing: $(grep -F "$verb" "$d/calls.txt" | head -1)"
  fi
done
echo "  locked-out  -> refused to start while another deploy held the lock; pulled, restarted and removed nothing"; pass_count=$((pass_count+1))

# --- no server: must abort BEFORE restarting anything ------------------------
d=$(run_deploy no-server ui)
assert_failed "$d"
if grep -qE 'up -d' "$d/calls.txt"; then
  fail "a compose file with no 'server' service still reached the restart phase; it must abort first"
fi
grep -qi "no 'server' service" "$d/out.txt" \
  || fail "no-server case did not report why it aborted; output was: $(head -3 "$d/out.txt")"
echo "  no-server   -> exited nonzero before any restart, with a clear reason"; pass_count=$((pass_count+1))

echo "== all $pass_count deploy-selection assertions passed =="
