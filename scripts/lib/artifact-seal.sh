# shellcheck shell=bash
# A file one CI job uploads and another downloads, sealed where it is written and checked where it
# is read: its artifact's name, its size and its SHA-256, in `<file>.seal` beside it.
#
# A download can arrive short. test:topbar's copy of server.tar.zst did: zstd stopped at
# "premature end" inside `docker load`, the job died before a test ran, and the message named
# neither the artifact nor the cause; a rerun passed. Checked here, a short or altered file stops
# the job before anything reads it, naming the artifact, both sizes and both digests. No retry:
# a rerun of the job downloads it again, and a retry here would hide how often it happens.
#
#   seal_artifact <file> <artifact-name>    after writing <file>, before the upload
#   verify_artifact <file>                  after the download, before <file> is read
#
# Sourced by scripts/ci-stack.sh; scripts/test-artifact-seal.sh is its test.

artifact_seal_fail() { echo "::error::$*" >&2; return 1; }

artifact_sha256() { sha256sum "$1" | cut -d' ' -f1; }
artifact_bytes() { wc -c < "$1" | tr -d '[:space:]'; }

seal_artifact() {
  local file="$1" artifact="$2"
  [ -n "$artifact" ] || artifact_seal_fail "seal_artifact: no artifact name for $file" || return 1
  [ -f "$file" ] || artifact_seal_fail "seal_artifact: no $file to seal (artifact $artifact)" || return 1
  printf 'artifact %s\nbytes %s\nsha256 %s\n' "$artifact" "$(artifact_bytes "$file")" "$(artifact_sha256 "$file")" > "$file.seal"
}

verify_artifact() {
  local file="$1" name artifact want_bytes want_sha got_bytes got_sha
  name="$(basename "$file")"
  [ -f "$file.seal" ] || artifact_seal_fail "$name came with no $name.seal: the download is incomplete, or its job wrote no seal" || return 1
  artifact="$(awk '$1 == "artifact" { print $2 }' "$file.seal")"
  want_bytes="$(awk '$1 == "bytes" { print $2 }' "$file.seal")"
  want_sha="$(awk '$1 == "sha256" { print $2 }' "$file.seal")"
  [ -n "$artifact" ] && [ -n "$want_bytes" ] && [ -n "$want_sha" ] \
    || artifact_seal_fail "$name.seal is not a seal (artifact, bytes, sha256): the download is corrupt" || return 1
  [ -f "$file" ] || artifact_seal_fail "artifact $artifact: $name is missing from the download" || return 1
  got_bytes="$(artifact_bytes "$file")"
  got_sha="$(artifact_sha256 "$file")"
  [ "$got_bytes" = "$want_bytes" ] && [ "$got_sha" = "$want_sha" ] || artifact_seal_fail \
    "artifact $artifact: $name downloaded as $got_bytes bytes, sha256 $got_sha; the job that uploaded it wrote" \
    "$want_bytes bytes, sha256 $want_sha. The download is truncated or corrupt and nothing from it was read." \
    "Re-run the job." || return 1
  echo "artifact $artifact: $name verified ($got_bytes bytes, sha256 $got_sha)"
}
