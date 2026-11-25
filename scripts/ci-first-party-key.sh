#!/bin/sh
# Whether built server artifacts carry the CI first-party root's key (the published test seed's,
# citadel-workspace-server-kernel/src/kernel/apps/ci_first_party_root.rs), which only a kernel built
# with the `ci-first-party-root` feature contains: the key is a string constant, so a build that
# trusts it holds its hex verbatim.
#
#   ci-first-party-key.sh absent <artifact>...    every artifact must lack it (anything that ships)
#   ci-first-party-key.sh present <artifact>...   every artifact must hold it (the integration
#                                                 image's kernel: proves this check sees a real one)
#
# Run by deploy/tenant-worker/deploy.sh on the server wasm and by docker/workspace-server/Dockerfile
# on each kernel it builds. POSIX sh: the Dockerfile runs it with the image's /bin/sh.
set -eu

die() { echo "ci-first-party-key: $*" >&2; exit 1; }

src="$(dirname "$0")/../citadel-workspace-server-kernel/src/kernel/apps/ci_first_party_root.rs"
[ $# -ge 2 ] || die "usage: ci-first-party-key.sh absent|present <artifact>..."
want="$1"
shift
case "$want" in absent|present) ;; *) die "'$want' is neither absent nor present" ;; esac
[ -f "$src" ] || die "$src is missing"
key="$(sed -n 's/^pub const CI_FIRST_PARTY_PUBLISHER_KEYS: &\[&str\] = &\["\([0-9a-f]*\)"\];$/\1/p' "$src")"
[ "${#key}" -eq 3904 ] || die "$src no longer declares one ML-DSA-65 key as CI_FIRST_PARTY_PUBLISHER_KEYS"

for artifact in "$@"; do
  [ -s "$artifact" ] || die "$artifact is missing or empty"
  # grep's 1 is "not found" and anything above it an error, which must never read as absent.
  status=0
  grep -qF -- "$key" "$artifact" || status=$?
  case "$status" in
    0) has=present ;;
    1) has=absent ;;
    *) die "could not read $artifact (grep exited $status)" ;;
  esac
  [ "$has" = "$want" ] || die "$artifact: the CI first-party root's key is $has, and must be $want"
  echo "ci-first-party-key: $artifact: the CI root's key is $has, as it must be"
done
