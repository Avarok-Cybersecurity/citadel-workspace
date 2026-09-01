#!/usr/bin/env bash
#
# Pull every base image the Dockerfiles name, retrying each.
#
# `check-image-fetches-retry.mjs` made sure a RUN line that downloads something
# sits in a retry loop. It cannot see the fetch that happens before any RUN: the
# base-image manifest pull for `FROM rust:1.92.0`. A run died on
#
#   unexpected status from HEAD request to
#   https://registry-1.docker.io/v2/library/rust/manifests/1.92.0: 502 Bad Gateway
#
# and took test:tree-permissions with it -- a red job carrying no test signal,
# for the same reason and in the same shape as the failure that gate was written
# for. The retry reached one kind of fetch in an image build and not the other.
#
# Running this before `docker compose --build` puts the images in the local
# store, so FROM resolves without touching the registry.
#
# The image list is derived from the Dockerfiles, never restated here: a list in
# two places is a list that goes stale in one of them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ATTEMPTS="${PULL_ATTEMPTS:-5}"

# How long one pull may take before it is treated as stalled.
PULL_TIMEOUT="${PULL_TIMEOUT:-300}"

# `FROM <ref> [AS <stage>]`, keeping only refs that name a registry image.
# A bare `FROM builder AS dev` refers to an earlier stage in the same file and
# has nothing to pull; requiring a tag or a registry path excludes those.
# `mapfile` is bash 4; macOS ships bash 3.2, and a script that only runs on the
# runner is one nobody can rehearse a failure against.
IMAGES=()
while IFS= read -r image; do
  [ -n "$image" ] && IMAGES+=("$image")
done < <(
  find "$ROOT" \
    -name node_modules -prune -o -name target -prune -o -name .git -prune -o \
    -type f \( -name 'Dockerfile' -o -name 'Dockerfile.*' \) -print 2>/dev/null |
    xargs grep -hE '^[[:space:]]*FROM[[:space:]]+' 2>/dev/null |
    sed -E 's/^[[:space:]]*FROM[[:space:]]+(--platform=[^[:space:]]+[[:space:]]+)?([^[:space:]]+).*/\2/' |
    grep -E ':|/' |
    sort -u
)

# BuildKit's frontend image, named by `# syntax=`, is pulled by BuildKit itself
# and is not a FROM -- so the collector above never saw it and it got none of
# the retries. Run 33356652733 died on exactly that: `failed to resolve source
# metadata for docker.io/docker/dockerfile:1.7-labs`, before a single RUN, which
# takes the whole image down and every job behind it with no test output at all.
# `workspace-server` needs the labs frontend for `COPY --exclude`, so removing
# the directive is not an option; pre-pulling it with the same retries is.
while IFS= read -r image; do
  [ -n "$image" ] && IMAGES+=("$image")
done < <(
  find "$ROOT" \
    -name node_modules -prune -o -name target -prune -o -name .git -prune -o \
    -type f \( -name 'Dockerfile' -o -name 'Dockerfile.*' \) -print 2>/dev/null |
    xargs grep -hE '^[[:space:]]*#[[:space:]]*syntax=' 2>/dev/null |
    sed -E 's/^[[:space:]]*#[[:space:]]*syntax=([^[:space:]]+).*/\1/' |
    grep -E ':|/' |
    sort -u
)

if [ ${#IMAGES[@]} -eq 0 ]; then
  echo "No base images found -- this script is looking in the wrong place." >&2
  exit 1
fi

echo "Pre-pulling ${#IMAGES[@]} base image(s), ${ATTEMPTS} attempts each, ${PULL_TIMEOUT}s each."

failed=()
for image in "${IMAGES[@]}"; do
  for attempt in $(seq 1 "$ATTEMPTS"); do
    # `timeout`, because a retry loop is no defence against a HANG. Retries
    # answer a pull that FAILS; a pull that stalls holds the loop on attempt
    # one until the job budget kills the whole thing. `test:settings-controls`
    # was cancelled that way in run 33308312708 -- its last step was this
    # script and its orphan process was `docker`.
    #
    # Same lesson as the browser install in round 440, in the script that
    # already had the retries and not the bound.
    if timeout "$PULL_TIMEOUT" docker pull --quiet "$image" >/dev/null 2>&1; then
      echo "  ok   $image"
      break
    fi
    if [ "$attempt" -eq "$ATTEMPTS" ]; then
      echo "  FAIL $image (after ${ATTEMPTS} attempts)"
      failed+=("$image")
      break
    fi
    # Registry 502s cluster; back off rather than hammering.
    sleep $((attempt * 5))
  done
done

if [ ${#failed[@]} -gt 0 ]; then
  echo "Could not pull: ${failed[*]}" >&2
  exit 1
fi
