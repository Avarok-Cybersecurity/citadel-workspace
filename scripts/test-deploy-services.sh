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
        # deploy.sh reads this twice before mutating anything: once to key the lock, once
        # after the pull to confirm the project was not renamed underneath it.
        # $RENAME_PROJECT_AFTER_PULL makes the second answer differ, which is the only way to
        # exercise that guard.
        name=stubproj
        if [ -n "${RENAME_PROJECT_AFTER_PULL:-}" ]; then
          n=$(cat "$CFGCOUNT" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$CFGCOUNT"
          [ "$n" -ge 2 ] && name=renamedproj
        fi
        printf '{"name":"%s","services":{' "$name"
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
  svc=""; proj=""; want_service_only=0
  for a in "$@"; do
    case "$a" in
      *com.docker.compose.project=*) proj="${a##*=}" ;;
      *com.docker.compose.service=*) svc="${a##*=}" ;;
      *com.docker.compose.oneoff=False) want_service_only=1 ;;
    esac
  done
  # This host also runs an UNRELATED compose project with the same service names - the normal case
  # for a box hosting more than one stack. Which containers a query reveals therefore depends on
  # whether it is scoped by project:
  #
  #   proj=stubproj -> only this deployment's containers
  #   proj=""       -> the query was NOT scoped, so it sees the other project's containers too
  #   anything else -> nothing here
  #
  # The middle case is the point. It is what lets the suite detect a regression that drops the
  # project filter from a destructive `docker rm -f`, which in production would tear down another
  # project's identically-named services. Without it the stub answers the same thing either way
  # and the assertions pass with the safety scoping removed.
  # A removed container must stop being listed, otherwise deploy.sh's confirm-it-is-gone re-query
  # can never succeed and the test could not tell a real failure from a working removal.
  # $RM_NOOP makes `rm` a no-op instead, to exercise the "still present afterwards" path.
  gone() { [ -f "$REMOVED" ] && grep -qx "$1" "$REMOVED"; }
  emit_for_project() { # <id-prefix>
    case " ${PREEXISTING:-} " in *" $svc "*) gone "$1$svc" || echo "$1$svc" ;; esac
    # A `docker compose run` container carries the same project+service labels and is excluded only
    # by oneoff=False, so emit it whenever that filter is absent - same trick, different filter.
    if [ "$want_service_only" = "0" ]; then
      case " ${PREEXISTING_ONEOFF:-} " in *" $svc "*) gone "${1}oneoff-$svc" || echo "${1}oneoff-$svc" ;; esac
    fi
  }
  case "$proj" in
    stubproj) emit_for_project "cid-" ;;
    "")       emit_for_project "cid-"; emit_for_project "cid-otherproj-" ;;
    *)        : ;;
  esac
  exit 0
fi

if [ "${1:-}" = "rm" ]; then
  if [ -z "${RM_NOOP:-}" ]; then
    shift; for a in "$@"; do case "$a" in -*) ;; *) echo "$a" >> "$REMOVED" ;; esac; done
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
  # HOME drives the default lock location, so point it at the fixture tree: the suite must never
  # touch the real one, and this also exercises the default path derivation rather than bypassing
  # it with DEPLOY_LOCK_FILE.
  export HOME="${HOME_OVERRIDE:-$WORK/home}"
  # The canonical lock root is host policy; point it at the fixture tree so a case can decide
  # whether this deployment is authorized to remove containers by provisioning the file or not.
  export CITADEL_DEPLOY_LOCK_ROOT="${LOCK_ROOT_OVERRIDE:-$WORK/canonical}"
  export CALLS="$dir/calls.txt"
  export CFGCOUNT="$dir/cfgcount.txt"
  export REMOVED="$dir/removed.txt"
  export RM_NOOP="${RM_NOOP:-}"
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

# Stand in for the administrator having provisioned the canonical lock: with it present, deploys
# of this project all contend on one inode and are authorized to retire dropped services. The
# slim-unlocked case points the root elsewhere to exercise the un-provisioned host.
mkdir -p "$WORK/canonical" && : > "$WORK/canonical/stubproj.lock"

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
# cloudflared is in PREEXISTING on purpose: the stub can then hand back cid-cloudflared if the
# reconciliation ever queries it, which is what makes the "never touches the tunnel" assertion
# below able to FAIL. Without it that assertion passes no matter what the code does.
d=$(PREEXISTING="server internal-service ui cloudflared" PREEXISTING_ONEOFF="ui" run_deploy slim-transition server)
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
# Containers of an unrelated compose project on the same host share these service names. Removing
# one would take down a different stack entirely, so the destructive query must be project-scoped.
if grep -qE '^rm -f .*cid-otherproj-' "$d/calls.txt"; then
  fail "reconciliation removed a container belonging to ANOTHER compose project: $(grep -E '^rm -f .*cid-otherproj-' "$d/calls.txt" | head -1)"
fi
echo "  slim-transition -> dropped ui and internal-service removed; server, cloudflared, one-off jobs and other projects untouched"; pass_count=$((pass_count+1))

# --- slimming WITHOUT a host-wide lock must report, not remove ---------------
# Removal matches containers by compose project, which spans every account on the host, so it only
# runs when an explicit shared DEPLOY_LOCK_FILE says deploys are serialized that widely. Without
# one the deploy must still succeed and must still tell the operator what is stale - silently
# leaving a dropped service serving traffic is the bug this reconciliation exists to fix, and
# silently removing it is the race the lock exists to prevent.
d=$(PREEXISTING="server internal-service ui" LOCK_ROOT_OVERRIDE="$WORK/no-canonical" run_deploy slim-unlocked server)
assert_failed "$d"
assert_removed_nothing "$d"
for verb in 'pull ' 'up -d'; do
  if grep -qF "$verb" "$d/calls.txt"; then
    fail "an unauthorized slim deploy ran '$verb' before refusing - it must refuse before mutating anything: $(grep -F "$verb" "$d/calls.txt" | head -1)"
  fi
done
grep -q "no longer declares" "$d/out.txt" \
  || fail "the refusal did not name the dropped services; output was: $(tail -6 "$d/out.txt")"
grep -q "install -o root -g docker" "$d/out.txt" \
  || fail "the refusal did not say how to authorize cleanup; output was: $(tail -6 "$d/out.txt")"
echo "  slim-unlocked -> refused before pulling or restarting, and said how to authorize cleanup"; pass_count=$((pass_count+1))

# --- an explicit lock path must NOT authorize removal ------------------------
# Supplying an absolute DEPLOY_LOCK_FILE proves a path was chosen, not that every deployment of
# this project chose the SAME one - two accounts can each set a different valid path, hold two
# different locks at once, and then remove containers matched by the shared project label. Only
# the canonical path establishes that, so removal must stay refused here.
d=$(PREEXISTING="server internal-service ui" LOCK_ROOT_OVERRIDE="$WORK/no-canonical" \
    DEPLOY_LOCK_FILE="$WORK/an-explicit-but-private.lock" run_deploy explicit-not-canonical server)
assert_failed "$d"
assert_removed_nothing "$d"
grep -q "no longer declares" "$d/out.txt" \
  || fail "an explicit-but-non-canonical lock authorized removal; output was: $(tail -6 "$d/out.txt")"
echo "  explicit-lock -> a private lock path did not authorize removal"; pass_count=$((pass_count+1))

# --- removal that does not take effect must fail the deploy ------------------
# The requested topology is "ui is gone". If it is still there afterwards, exiting 0 would let
# automation record the slim topology as live while the old ui keeps serving - so the run fails,
# after the services that did deploy are up.
d=$(PREEXISTING="server internal-service ui" RM_NOOP=1 run_deploy rm-noop server)
assert_failed "$d"
grep -q "still present after removal" "$d/out.txt" \
  || fail "a removal that did not take effect was not detected; output was: $(tail -6 "$d/out.txt")"
grep -q "does not match" "$d/out.txt" \
  || fail "the deploy did not report the topology mismatch; output was: $(tail -6 "$d/out.txt")"
grep -q "up -d --no-deps server" "$d/calls.txt" \
  || fail "the failure should come AFTER the deployable services are up, not instead of it"
echo "  rm-noop     -> failed the run when a dropped service survived removal, after deploying the rest"; pass_count=$((pass_count+1))

# --- a deploy from ANOTHER checkout of the same project must be refused ------
# The reconciliation above removes containers selected by the compose PROJECT label, whose scope
# spans every checkout on the host - so a directory-scoped lock would leave the destructive race
# open exactly where it does the most damage. This holds the project lock as a deploy running from
# some other directory would, then deploys from a different directory entirely, and asserts the
# second run is refused having mutated NOTHING.
lock_file="$WORK/canonical/stubproj.lock"
exec 8>>"$lock_file"
flock -n 8 || fail "could not acquire $lock_file to set up the concurrency test"
# TMPDIR is deliberately bogus: a lock a caller's environment can relocate is one two deploys can
# each miss, so the path must not derive from it.
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
echo "  locked-out  -> a different checkout of the same project was refused; pulled, restarted and removed nothing"; pass_count=$((pass_count+1))
exec 8>&-

# --- a shared DEPLOY_LOCK_FILE serializes across ACCOUNTS --------------------
# The per-account default cannot cover two accounts deploying one project: the lock file the first
# creates is mode 644, so the second cannot open it for append. A group-writable path every account
# points at is the supported way to close that, so pin that it actually works - different HOME,
# same DEPLOY_LOCK_FILE, second run refused before touching anything.
shared_lock="$WORK/shared-deploy.lock"
exec 8>>"$shared_lock"
flock -n 8 || fail "could not acquire $shared_lock to set up the cross-account test"
d=$(HOME_OVERRIDE="$WORK/other-account" DEPLOY_LOCK_FILE="$shared_lock" run_deploy other-account server)
exec 8>&-
assert_failed "$d"
grep -qi "another deploy" "$d/out.txt" \
  || fail "a deploy blocked by the shared lock did not say why; output was: $(head -3 "$d/out.txt")"
for verb in 'pull ' 'up -d' 'rm -f'; do
  if grep -qF "$verb" "$d/calls.txt"; then
    fail "a deploy blocked by the shared lock still ran '$verb': $(grep -F "$verb" "$d/calls.txt" | head -1)"
  fi
done
echo "  other-acct  -> a different account sharing DEPLOY_LOCK_FILE was refused; mutated nothing"; pass_count=$((pass_count+1))

# --- a pulled revision that renames the project must abort -------------------
# The lock is keyed on the project name read before the pull. If the pull renames the project, the
# run would hold one project's lock while restarting and removing another's containers. Assert it
# stops instead, and that it stops before touching anything.
d=$(RENAME_PROJECT_AFTER_PULL=1 run_deploy renamed server)
assert_failed "$d"
grep -qi "changes the compose project" "$d/out.txt" \
  || fail "a project rename mid-deploy did not report why it aborted; output was: $(tail -3 "$d/out.txt")"
for verb in 'pull ' 'up -d' 'rm -f'; do
  if grep -qF "$verb" "$d/calls.txt"; then
    fail "a deploy that detected a project rename still ran '$verb' - it must mutate nothing: $(grep -F "$verb" "$d/calls.txt" | head -1)"
  fi
done
echo "  renamed     -> aborted on a mid-deploy project rename, having mutated nothing"; pass_count=$((pass_count+1))

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
