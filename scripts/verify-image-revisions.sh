#!/usr/bin/env bash
# =============================================================================
# Verify that a set of container images were all built from the SAME commit.
#
# WHY THIS IS A SEPARATE, TESTABLE SCRIPT
#
# `latest` is a mutable tag on INDEPENDENT registry repositories, and no registry
# offers an atomic multi-repository tag update. CI advances the tags in a
# `promote-latest` job that only runs once every image has built and passed its
# smoke test, but a promotion that succeeds for one image and then fails partway
# (transient registry / auth error) would still leave `latest` pointing at a
# MISMATCHED pair. A plain `./deploy.sh` would then restart production on two
# backend versions that never shipped together.
#
# So rather than trusting the tag, we verify the artifacts: CI stamps every image
# with `org.opencontainers.image.revision` (the commit it was built from), and
# this script refuses the deploy if they disagree.
#
# It lives outside deploy.sh because it is the SAFETY GATE - an untested safety
# gate is a liability. Pulled out here it takes images as arguments, touches no
# global state, and is exercised directly by CI
# (.github/workflows/validate.yml -> deploy-gate-tests) against real images with
# matching, mismatched, and absent labels.
#
# Usage:   verify-image-revisions.sh <image> [<image> ...]
# Exit 0:  all images carry the same revision, OR one or more carry no label at
#          all (a warning - locally-built and pre-label images are not blocked).
# Exit 1:  two images carry DIFFERENT revisions.
# =============================================================================

set -euo pipefail

if [ "$#" -lt 2 ]; then
    echo "usage: $0 <image> <image> [<image> ...]" >&2
    exit 2
fi

REVISION_LABEL="org.opencontainers.image.revision"

image_revision() {
    # `docker image inspect` prints the literal string `<no value>` when the label
    # is absent, so normalise that to an empty string.
    local rev
    rev=$(docker image inspect --format "{{ index .Config.Labels \"$REVISION_LABEL\" }}" "$1" 2>/dev/null || true)
    if [ "$rev" = "<no value>" ]; then
        rev=""
    fi
    printf '%s' "$rev"
}

reference_rev=""
reference_img=""
unlabelled=0

for img in "$@"; do
    rev=$(image_revision "$img")

    if [ -z "$rev" ]; then
        # Images built before the label existed, or built locally, carry no revision.
        # Warn but do not block: refusing to deploy an unlabelled image would strand
        # anyone on an older build or a local build.
        echo "WARNING: ${img} carries no ${REVISION_LABEL} label; cannot verify it." >&2
        unlabelled=1
        continue
    fi

    if [ -z "$reference_rev" ]; then
        reference_rev="$rev"
        reference_img="$img"
        continue
    fi

    if [ "$rev" != "$reference_rev" ]; then
        echo "" >&2
        echo "ERROR: these images were built from DIFFERENT commits. Refusing to deploy." >&2
        echo "  ${reference_img}" >&2
        echo "    revision ${reference_rev}" >&2
        echo "  ${img}" >&2
        echo "    revision ${rev}" >&2
        echo "" >&2
        echo "  This usually means a 'latest' promotion only partially completed. Deploy an" >&2
        echo "  explicit, immutable tag instead, which is consistent by construction:" >&2
        echo "    IMAGE_TAG=sha-<12-char-sha> ./deploy.sh" >&2
        echo "  Available tags: https://github.com/orgs/Avarok-Cybersecurity/packages" >&2
        exit 1
    fi
done

if [ "$unlabelled" -eq 1 ]; then
    echo "Revision check skipped: at least one image carries no revision label."
    exit 0
fi

echo "All images are from commit ${reference_rev}."
