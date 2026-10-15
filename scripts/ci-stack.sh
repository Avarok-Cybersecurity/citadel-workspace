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
#   ci-stack.sh cache-key <service>    the cache key of a backend image (server, internal-service)
#   ci-stack.sh reuse <service> <tar> <out>
#                                      take a cached backend image instead of building it: prove
#                                      it was built from this checkout's backend repos, restamp
#                                      it for this run, and save it to <out> like `build` does
#
# Caching is for the UI repository's CI, whose pull requests never change the Rust: the server
# and agent images there depend only on the parent and agent commits, yet every run rebuilt them
# (~17 min on the critical path). A backend image's provenance is the `backend` identity -- every
# repository in the checkout except the UI, which no backend Dockerfile copies (checked below,
# not assumed). `load` is unchanged: a reused image carries this run's full identity only after
# `reuse` has proved its backend identity and revision.
#
# The images are the ones `docker compose up --build` would have built: same compose file,
# same Dockerfiles, same build args. The only additions are three labels, which is what lets
# every consumer check where an image came from.
set -euo pipefail
# A `die` inside a command substitution must end the script, not just the substitution: an
# identity computed over a checkout missing a submodule would otherwise hash what it found.
shopt -s inherit_errexit

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

# The repository list is collected before it is used, never read from `< <(repos .)`: a `die`
# inside a process substitution is invisible to the caller, so a missing submodule used to
# print its error and leave the rest of the identity (or the clean check) to carry on without it.
repo_list() { local list; list="$(repos .)"; printf '%s\n' "$list"; }

identity() {
  local repo list sha
  list="$(repo_list)"
  while read -r repo; do
    sha="$(git -C "$repo" rev-parse HEAD)"
    printf '%s %s\n' "${repo#./}" "$sha"
  done <<< "$list"
}

identity_hash() { identity | sha256sum | cut -d' ' -f1; }

# What the server and agent images are built from: every repository but the UI's.
BACKEND_SERVICES=(server internal-service)
UI_REPO=citadel-workspaces
backend_identity() { identity | awk -v ui="$UI_REPO" '$1 != ui && index($1, ui "/") != 1'; }
backend_hash() { backend_identity | sha256sum | cut -d' ' -f1; }

# The labels name commits, so the tracked files must BE those commits. Submodule pointers are
# excluded at each level because each submodule is checked on its own line of `repos`.
require_clean() {
  local repo list
  list="$(repo_list)"
  while read -r repo; do
    git -C "$repo" diff --quiet --ignore-submodules=all HEAD \
      || die "$repo has modified tracked files; an image built or tested here would not be its commit"
  done <<< "$list"
}

project() { docker compose config --format json | jq -er .name; }
image_of() { printf '%s-%s' "$(project)" "$1"; }

label() { docker image inspect --format "{{ index .Config.Labels \"$2\" }}" "$1"; }

# A backend service whose Dockerfile copies nothing from the UI (no COPY/ADD of the UI's path,
# and no whole-context `.`), so the backend identity really is everything it is built from.
require_backend() {
  local svc="$1" dockerfile
  printf '%s\n' "${BACKEND_SERVICES[@]}" | grep -qx "$svc" || die "'$svc' is not a backend service (${BACKEND_SERVICES[*]})"
  dockerfile="$(docker compose config --format json \
    | jq -er --arg s "$svc" '.services[$s].build | .context + "/" + .dockerfile')"
  [ -f "$dockerfile" ] || die "$svc's Dockerfile $dockerfile does not exist"
  if grep -Ei '^[[:space:]]*(COPY|ADD)[[:space:]]' "$dockerfile" | grep -v -- '--from=' \
      | grep -Eq "(^|[[:space:]])\./?([[:space:]]|\$)|$UI_REPO"; then
    die "$dockerfile copies the UI or the whole context; its image is not determined by the backend repos"
  fi
}

build() {
  local svc="$1" out="$2"
  need_env GITHUB_RUN_ID
  printf '%s\n' "${SERVICES[@]}" | grep -qx "$svc" || die "unknown service '$svc'"
  require_clean
  CI_STACK_SOURCE="$(identity_hash)" CI_STACK_REVISION="$(git rev-parse HEAD)" \
    CI_STACK_RUN="$GITHUB_RUN_ID" CI_STACK_BACKEND="$(backend_hash)" \
    docker compose -f docker-compose.yml -f "$BUILD_OVERRIDE" build "$svc"
  mkdir -p "$out"
  docker save "$(image_of "$svc")" | zstd -T0 -3 -q -o "$out/$svc.tar.zst"
  identity > "$out/$svc.source"
  ls -l "$out/$svc.tar.zst"
}

sync_products() {
  local out="$1" marker list repo prefix checkout
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
  checkout="$(repo_list)"
  while read -r repo; do
    prefix="${repo#./}/"; [ "$repo" = . ] && prefix=""
    git -C "$repo" ls-files --deleted | sed "s|^|$prefix|" >> "$out/sync-products.deleted"
  done <<< "$checkout"
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

cache_key() {
  local hash
  require_backend "$1"
  hash="$(backend_hash)"
  printf 'ci-stack-%s-%s\n' "$1" "$hash"
}

reuse() {
  local svc="$1" tar="$2" out="$3" img want rev got built
  need_env GITHUB_RUN_ID
  require_backend "$svc"
  require_clean
  [ -f "$tar" ] || die "no cached image at $tar"
  want="$(backend_hash)"
  rev="$(git rev-parse HEAD)"
  zstd -dc "$tar" | docker load
  img="$(image_of "$svc")"
  got="$(label "$img" com.avarok.ci.backend)"
  [ "$got" = "$want" ] || die "cached $img was built from other backend repos (backend $got, this checkout $want)"
  ./scripts/verify-image-revisions.sh --expect "$rev" "$img"
  built="$(label "$img" com.avarok.ci.run)"
  # Restamp for this run and this checkout's full identity, which is what `load` checks. A
  # one-line FROM adds no layer: the layers are the cached ones, byte for byte, and only the
  # image config's labels change (CMD, ENV and the rest are inherited as they were).
  printf 'FROM %s\n' "$img" | docker build --quiet --pull=false \
    --label "com.avarok.ci.source=$(identity_hash)" \
    --label "com.avarok.ci.run=$GITHUB_RUN_ID" \
    -t "$img" - >/dev/null
  echo "reused $img (backend $want, revision $rev, built by run $built -> restamped for $GITHUB_RUN_ID)"
  mkdir -p "$out"
  docker save "$img" | zstd -T0 -3 -q -o "$out/$svc.tar.zst"
  identity > "$out/$svc.source"
  ls -l "$out/$svc.tar.zst"
}

case "${1:-}" in
  identity) identity ;;
  build) [ $# -eq 3 ] || die "usage: ci-stack.sh build <service> <out>"; build "$2" "$3" ;;
  sync-products) [ $# -eq 2 ] || die "usage: ci-stack.sh sync-products <out>"; sync_products "$2" ;;
  load) [ $# -eq 2 ] || die "usage: ci-stack.sh load <dir>"; load "$2" ;;
  cache-key) [ $# -eq 2 ] || die "usage: ci-stack.sh cache-key <service>"; cache_key "$2" ;;
  reuse) [ $# -eq 4 ] || die "usage: ci-stack.sh reuse <service> <tar> <out>"; reuse "$2" "$3" "$4" ;;
  *) die "usage: ci-stack.sh identity | build <service> <out> | sync-products <out> | load <dir> | cache-key <service> | reuse <service> <tar> <out>" ;;
esac
