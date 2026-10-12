#!/usr/bin/env bash
# The integration stack, built ONCE per CI run and loaded by every job that tests against it.
#
# Every integration leg used to run `docker compose up --build`: about 17 minutes of image
# builds (two release Rust compiles) and 7 minutes of WASM sync, before a test of 2-7 minutes.
# Fifty-odd legs did that per run, from the same commit -- run 38056778313 spent 25.7 of
# test:crud's 30 minutes in "Start Services". Now one job per image builds it, the sync runs
# once, and each leg loads the result, refusing anything that was not built from the exact
# checkout it is about to test.
#
#   ci-stack.sh identity               the source identity of this checkout, one repo per line
#   ci-stack.sh build <service> <out>  build one compose service (labelled) and save it to <out>
#   ci-stack.sh sync-products <out>    run the WASM sync once and capture every file it wrote
#   ci-stack.sh load <dir>             load what the build jobs saved, prove it, wire compose
#
# The images are the ones `docker compose up --build` would have built: same compose file,
# same Dockerfiles, same build args. The only additions are three labels, which is what lets
# every consumer check where an image came from.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SERVICES=(sync-wasm-client server internal-service ui)
BUILD_OVERRIDE="docker/ci/compose.stack-build.yml"
RUNTIME_OVERRIDE="docker/ci/compose.prebuilt.yml"
# Everything the sync container bind-mounts from the checkout (docker-compose.yml). It can
# write nowhere else on the host, so these three directories bound what it produced.
SYNC_MOUNTS=(citadel-internal-service citadel-workspace-client-ts citadel-workspaces)

die() { echo "::error::ci-stack: $*" >&2; exit 1; }
need_env() { [ -n "${!1:-}" ] || die "$1 is not set"; }

# Every repository in the checkout: the parent, then each gitlink recursively. Read from the
# index (mode 160000), not .gitmodules, which lists a stale entry the tree has no gitlink for.
repos() {
  local dir="$1" path
  echo "$dir"
  while read -r path; do
    [ -e "$dir/$path/.git" ] || die "$dir/$path is a submodule of the tree but is not checked out"
    repos "$dir/$path"
  done < <(git -C "$dir" ls-files -s | awk '$1 == "160000" { print $4 }')
}

identity() {
  local repo
  while read -r repo; do
    printf '%s %s\n' "${repo#./}" "$(git -C "$repo" rev-parse HEAD)"
  done < <(repos .)
}

identity_hash() { identity | sha256sum | cut -d' ' -f1; }

# The labels name commits, so the tracked files must BE those commits. Submodule pointers are
# excluded at each level because each submodule is checked on its own line of `repos`.
require_clean() {
  local repo
  while read -r repo; do
    git -C "$repo" diff --quiet --ignore-submodules=all HEAD \
      || die "$repo has modified tracked files; an image built or tested here would not be its commit"
  done < <(repos .)
}

project() { docker compose config --format json | jq -er .name; }
image_of() { printf '%s-%s' "$(project)" "$1"; }

label() { docker image inspect --format "{{ index .Config.Labels \"$2\" }}" "$1"; }

build() {
  local svc="$1" out="$2"
  need_env GITHUB_RUN_ID
  printf '%s\n' "${SERVICES[@]}" | grep -qx "$svc" || die "unknown service '$svc'"
  require_clean
  CI_STACK_SOURCE="$(identity_hash)" CI_STACK_REVISION="$(git rev-parse HEAD)" \
    CI_STACK_RUN="$GITHUB_RUN_ID" \
    docker compose -f docker-compose.yml -f "$BUILD_OVERRIDE" build "$svc"
  mkdir -p "$out"
  docker save "$(image_of "$svc")" | zstd -T0 -3 -q -o "$out/$svc.tar.zst"
  identity > "$out/$svc.source"
  ls -l "$out/$svc.tar.zst"
}

sync_products() {
  local out="$1" marker list repo prefix
  require_clean
  mkdir -p "$out"
  marker="$(mktemp)"; list="$(mktemp)"
  # mtime has one-second resolution on some filesystems; make "newer" unambiguous.
  sleep 1
  docker compose up --no-build --exit-code-from sync-wasm-client sync-wasm-client
  # What the sync wrote, minus the directories it shadows with named volumes (node_modules,
  # the UI's dist) and build caches. Paths are relative to the checkout root.
  find "${SYNC_MOUNTS[@]}" -newer "$marker" -type f \
    -not -path '*/node_modules/*' -not -path '*/target/*' -not -path '*/.git/*' \
    -not -path 'citadel-workspaces/dist/*' | LC_ALL=C sort > "$list"
  [ -s "$list" ] || die "the sync wrote nothing; there is nothing to hand the integration jobs"
  tar -cf - -T "$list" | zstd -T0 -3 -q -o "$out/sync-products.tar.zst"
  tr '\n' '\0' < "$list" | xargs -0 sha256sum > "$out/sync-products.sha256"
  # Tracked files the sync deleted and did not recreate must be deleted in each job too.
  : > "$out/sync-products.deleted"
  while read -r repo; do
    prefix="${repo#./}/"; [ "$repo" = . ] && prefix=""
    git -C "$repo" ls-files --deleted | sed "s|^|$prefix|" >> "$out/sync-products.deleted"
  done < <(repos .)
  identity > "$out/sync-products.source"
  echo "sync products: $(wc -l < "$list") files, $(wc -l < "$out/sync-products.deleted") deletions"
}

load() {
  local dir="$1" want rev svc img got imgs=()
  need_env GITHUB_RUN_ID
  need_env GITHUB_ENV
  require_clean
  want="$(identity_hash)"
  rev="$(git rev-parse HEAD)"
  echo "This checkout:"; identity | sed 's/^/  /'
  for svc in "${SERVICES[@]}"; do
    [ -f "$dir/$svc.tar.zst" ] || die "$svc was not built by this run (no $dir/$svc.tar.zst)"
    zstd -dc "$dir/$svc.tar.zst" | docker load
    rm -f "$dir/$svc.tar.zst"
    img="$(image_of "$svc")"
    got="$(label "$img" com.avarok.ci.source)"
    [ "$got" = "$want" ] || {
      echo "built from:"; sed 's/^/  /' "$dir/$svc.source"
      die "$img was built from a different checkout (source $got, this checkout $want)"
    }
    got="$(label "$img" com.avarok.ci.run)"
    [ "$got" = "$GITHUB_RUN_ID" ] || die "$img was built by run '$got', not this run ($GITHUB_RUN_ID)"
    imgs+=("$img")
  done
  # The same revision gate the deploy uses, now over the images this job is about to test.
  ./scripts/verify-image-revisions.sh --expect "$rev" "${imgs[@]}"

  cmp -s <(identity) "$dir/sync-products.source" \
    || die "the WASM sync products were produced from a different checkout"
  zstd -dc "$dir/sync-products.tar.zst" | tar -xf - -C "$ROOT"
  while read -r path; do [ -z "$path" ] || rm -f -- "$path"; done < "$dir/sync-products.deleted"
  sha256sum --check --strict --quiet "$dir/sync-products.sha256"
  echo "sync products: $(wc -l < "$dir/sync-products.sha256") files restored and verified"

  # Every later `docker compose` in the job -- Start Services, the log dumps, and the test
  # helpers that restart a service -- reads the same two files. The runtime override only
  # replaces the sync's command with a re-check of the products above.
  echo "COMPOSE_FILE=$ROOT/docker-compose.yml:$ROOT/$RUNTIME_OVERRIDE" >> "$GITHUB_ENV"
  echo "CI_STACK_SYNC_MANIFEST=$dir/sync-products.sha256" >> "$GITHUB_ENV"
}

case "${1:-}" in
  identity) identity ;;
  build) [ $# -eq 3 ] || die "usage: ci-stack.sh build <service> <out>"; build "$2" "$3" ;;
  sync-products) [ $# -eq 2 ] || die "usage: ci-stack.sh sync-products <out>"; sync_products "$2" ;;
  load) [ $# -eq 2 ] || die "usage: ci-stack.sh load <dir>"; load "$2" ;;
  *) die "usage: ci-stack.sh identity | build <service> <out> | sync-products <out> | load <dir>" ;;
esac
