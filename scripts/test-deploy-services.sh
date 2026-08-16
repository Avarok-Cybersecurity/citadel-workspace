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

# `docker ps -q --filter label=...project=X --filter label=...service=Y` - deploy.sh's check for
# services this compose file dropped that are still running. $PREEXISTING lists the services a
# PREVIOUS deploy left RUNNING containers for, so a case can model "full stack already running" and
# assert what a slimmed redeploy does about it. $PREEXISTING_ONEOFF models a `docker compose run`
# job, which carries the same project+service labels and is excluded only by oneoff=False.
#
# $PREEXISTING_EXITED and $PREEXISTING_LATENT model leftovers that are not serving right now. Real
# `docker ps` hides those unless `-a` is passed, so the stub keys off the flag rather than ignoring
# it - a deploy that queried only running containers would never see them, which is the regression
# the latent case below is built to catch.
#
# The two differ only in restart policy, which `docker inspect` reports: EXITED is
# `unless-stopped` and stays down, LATENT is `always` and comes back the next time the daemon
# starts. That distinction is the whole point of inspecting rather than trusting the state.
if [ "${1:-}" = "ps" ]; then
  svc=""; want_service_only=0; want_all=0; by_id=""
  for a in "$@"; do
    case "$a" in
      -a|-aq|-qa|--all) want_all=1 ;;
      *com.docker.compose.service=*) svc="${a##*=}" ;;
      *com.docker.compose.oneoff=False) want_service_only=1 ;;
      id=*) by_id="${a#id=}" ;;
    esac
  done
  # `ps -aq --filter id=X` is deploy.sh re-checking whether a container it failed to inspect is
  # still there. Nothing in these fixtures removes containers mid-run, so it still exists.
  if [ -n "$by_id" ]; then echo "$by_id"; exit 0; fi
  case " ${PREEXISTING:-} " in *" $svc "*) echo "cid-$svc" ;; esac
  # Real `docker ps` lists paused and restarting containers WITHOUT -a: both are still holding
  # their published ports, so they belong with the running ones, not with the exited ones.
  case " ${PREEXISTING_PAUSED:-} " in *" $svc "*) echo "cid-paused-$svc" ;; esac
  if [ "$want_all" = "1" ]; then
    case " ${PREEXISTING_EXITED:-} " in *" $svc "*) echo "cid-exited-$svc" ;; esac
    case " ${PREEXISTING_LATENT:-} " in *" $svc "*) echo "cid-latent-$svc" ;; esac
  fi
  if [ "$want_service_only" = "0" ]; then
    case " ${PREEXISTING_ONEOFF:-} " in *" $svc "*) echo "cid-oneoff-$svc" ;; esac
  fi
  exit 0
fi

# `docker inspect -f '{{.State.Status}} {{.HostConfig.RestartPolicy.Name}}' <cid>` - how deploy.sh
# tells a leftover that is merely dead from one that is waiting for the next daemon start.
if [ "${1:-}" = "inspect" ]; then
  for cid; do :; done   # last argument
  # $INSPECT_FAILS models a container docker will list but not describe. deploy.sh must refuse on
  # it rather than assume it is harmless, so the harness needs a way to produce one.
  case " ${INSPECT_FAILS:-} " in *" $cid "*) exit 1 ;; esac
  case "$cid" in
    cid-exited-*) echo "exited unless-stopped" ;;
    cid-paused-*) echo "paused unless-stopped" ;;
    cid-latent-*) echo "exited always" ;;
    *)            echo "running unless-stopped" ;;
  esac
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
  export PREEXISTING_EXITED="${PREEXISTING_EXITED:-}"
  export PREEXISTING_LATENT="${PREEXISTING_LATENT:-}"
  export PREEXISTING_PAUSED="${PREEXISTING_PAUSED:-}"
  export INSPECT_FAILS="${INSPECT_FAILS:-}"
  : > "$CALLS"
  # --no-pull skips step 1 (git pull); the fixture dir is deliberately not a git repo, and the
  # git step is not what is under test here.
  #
  # The status is RECORDED rather than discarded. Asserting only on the recorded docker calls
  # would let a deploy that makes every expected call and then dies in a later step pass the
  # whole suite - "it called the right things" is not the same claim as "it completed", and this
  # test exists to make the second one.
  #
  # HOME is redirected into the fixture so the project lock deploy.sh takes lands here rather than
  # in the real user's runtime directory - otherwise the suite would contend with an actual deploy
  # on the same machine, and leave files behind outside its own workspace.
  local status=0
  ( cd "$dir" && HOME="$dir" PATH="$WORK/bin:$PATH" \
      bash ./deploy.sh --no-pull >"$dir/out.txt" 2>&1 ) || status=$?
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

# --- slimming an EXISTING full stack: refuse, do not half-apply --------------
# `docker compose up` leaves containers for undeclared services running and merely warns, so
# guarding the restart alone would turn a loud failure into a silent one: the deploy would succeed
# while the old ui kept serving its previous image. The deploy must refuse BEFORE pulling or
# restarting - leaving the running stack exactly as it was - and say how to clear the leftovers.
d=$(PREEXISTING="server internal-service ui" PREEXISTING_ONEOFF="ui" run_deploy slim-transition server)
assert_failed "$d"
for verb in 'pull ' 'up -d'; do
  if grep -qF "$verb" "$d/calls.txt"; then
    fail "a deploy that cannot be completed still ran '$verb' - it must refuse before mutating anything: $(grep -F "$verb" "$d/calls.txt" | head -1)"
  fi
done
grep -q "no longer declares" "$d/out.txt" \
  || fail "the refusal did not name the dropped services; output was: $(tail -8 "$d/out.txt")"
grep -qE "docker rm -f .*cid-ui" "$d/out.txt" \
  || fail "the refusal did not print the command to clear the leftovers; output was: $(tail -8 "$d/out.txt")"
# A `docker compose run` job shares the project+service labels. It is somebody's migration or
# debugging session, not a stale service, and must not be reported as one.
grep -q "cid-oneoff-" "$d/out.txt" \
  && fail "a 'docker compose run' one-off container was reported as a stale service"
echo "  slim-transition -> refused before pulling or restarting, named the leftovers and how to clear them"; pass_count=$((pass_count+1))

# --- slimming with nothing left over: just deploys ---------------------------
# The refusal is about leftovers, not about the shape. A server-only deploy on a host where ui was
# never running has nothing to reconcile and must proceed untouched - otherwise the documented
# slim option would need a manual step it does not actually need.
d=$(run_deploy slim-clean server)
assert_succeeded "$d"
assert_pulled "$d" "server"
assert_restarted "$d" server
echo "  slim-clean  -> deployed normally when the dropped services left nothing behind"; pass_count=$((pass_count+1))

# --- slimming past INERT leftovers: also just deploys -------------------------
# An exited `unless-stopped` container serves nothing, holds no ports, and cannot come back on its
# own - the policy leaves a hand-stopped container stopped even across a daemon restart. Every host
# that has ever run the full stack accumulates these, so refusing over them would fail the
# documented slim deploy on exactly the hosts it is meant for, and send the operator to force-remove
# something already harmless.
d=$(PREEXISTING_EXITED="ui internal-service" run_deploy slim-exited server)
assert_succeeded "$d"
assert_pulled "$d" "server"
assert_restarted "$d" server
grep -q "cid-exited-" "$d/out.txt" \
  && fail "an inert exited container was reported as a stale service"
echo "  slim-exited -> deployed past inert exited leftovers instead of refusing over them"; pass_count=$((pass_count+1))

# --- an exited container that WILL come back: refuse -------------------------
# `restart: always` is the one policy that starts a hand-stopped container again the next time the
# Docker daemon does. Such a container is not serving now but is a stale service waiting on the
# next host reboot, so letting the deploy report success over it is the silent half-applied
# topology this guard exists to prevent - just deferred. Only the restart policy separates this
# from the case above, which is why the state alone cannot decide it.
d=$(PREEXISTING_LATENT="ui" run_deploy slim-latent server)
assert_failed "$d"
for verb in 'pull ' 'up -d'; do
  grep -qF "$verb" "$d/calls.txt" && fail "refused only after running '$verb'; it must refuse before mutating anything"
done
grep -qE "docker rm -f .*cid-latent-ui" "$d/out.txt" \
  || fail "an exited restart:always leftover was not reported; output was: $(tail -8 "$d/out.txt")"
grep -q "restarts on reboot" "$d/out.txt" \
  || fail "the refusal did not say WHY a stopped container blocks the deploy; output was: $(tail -8 "$d/out.txt")"
echo "  slim-latent -> refused on an exited restart:always leftover before mutating anything"; pass_count=$((pass_count+1))

# --- a PAUSED leftover refuses too -------------------------------------------
# A paused container is frozen, not gone: the daemon still holds its published ports, so a slim
# deploy that walked past one would leave :8080 bound by a service its compose file no longer
# declares. "Not running" is not the same as "not serving", which is why the classification keys
# off the full set of live states rather than a single equality against `running`.
d=$(PREEXISTING_PAUSED="ui" run_deploy slim-paused server)
assert_failed "$d"
grep -qE "docker rm -f .*cid-paused-ui" "$d/out.txt" \
  || fail "a paused leftover was not reported; output was: $(tail -8 "$d/out.txt")"
echo "  slim-paused -> refused on a paused leftover still holding its ports"; pass_count=$((pass_count+1))

# --- a RUNNING leftover still refuses, even beside exited ones ----------------
# Pins the boundary from the other side: classifying by policy must not have classified away the
# plain running container the guard exists to catch.
d=$(PREEXISTING="ui" PREEXISTING_EXITED="internal-service" run_deploy slim-mixed server)
assert_failed "$d"
grep -qE "docker rm -f .*cid-ui" "$d/out.txt" \
  || fail "a running leftover was not reported when an exited one was also present; output was: $(tail -8 "$d/out.txt")"
grep -q "cid-exited-" "$d/out.txt" \
  && fail "an inert container was listed alongside the running one the operator must clear"
echo "  slim-mixed  -> refused on the running leftover, ignored the inert one"; pass_count=$((pass_count+1))

# --- a leftover docker will list but not describe: refuse --------------------
# Whether a stopped leftover is inert or latent is decided entirely by its restart policy, so a
# container that cannot be inspected cannot be classified. Treating that as "probably fine" would
# put the guard's one unanswerable case on the silent-success side; it refuses instead.
d=$(PREEXISTING="ui" INSPECT_FAILS="cid-ui" run_deploy inspect-fails server)
assert_failed "$d"
grep -q "cannot inspect container" "$d/out.txt" \
  || fail "an uninspectable leftover did not stop the deploy; output was: $(tail -8 "$d/out.txt")"
echo "  inspect-fails -> refused on a leftover it could not classify"; pass_count=$((pass_count+1))

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
