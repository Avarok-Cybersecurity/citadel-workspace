#!/usr/bin/env bash
# Tests scripts/lib/artifact-seal.sh: a sealed file that arrives whole passes; one that arrives
# short, altered, without its seal or not at all fails, naming the artifact.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/artifact-seal.sh
. scripts/lib/artifact-seal.sh

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failures=0

# expect <name> <pass|fail> <message fragment> <setup command>: a fresh sealed file, the setup
# applied to it, then verify_artifact; checks the outcome and that its output says the fragment.
expect() {
  local name="$1" want="$2" fragment="$3" setup="$4" out rc=0 file="$work/server.tar.zst"
  rm -f "$file" "$file.seal"
  head -c 300000 /dev/urandom > "$file"
  seal_artifact "$file" ci-stack-server
  (cd "$work" && eval "$setup")
  out="$(verify_artifact "$file" 2>&1)" || rc=$?
  if { [ "$want" = pass ] && [ "$rc" -eq 0 ]; } || { [ "$want" = fail ] && [ "$rc" -ne 0 ]; }; then
    if [[ "$out" == *"$fragment"* ]]; then echo "ok    $name"; return; fi
    echo "FAIL  $name: the output does not say '$fragment': $out"
  else
    echo "FAIL  $name: expected $want, exit $rc: $out"
  fi
  failures=$((failures + 1))
}

expect 'a whole file passes' pass 'artifact ci-stack-server: server.tar.zst verified (300000 bytes' ':'
expect 'a truncated file fails, naming the artifact' fail \
  'artifact ci-stack-server: server.tar.zst downloaded as 299999 bytes' \
  'head -c 299999 server.tar.zst > t && mv t server.tar.zst'
expect 'a truncated file is called truncated' fail 'truncated or corrupt' 'head -c 1000 server.tar.zst > t && mv t server.tar.zst'
expect 'an altered file of the same size fails' fail 'downloaded as 300000 bytes' \
  'printf x | dd of=server.tar.zst bs=1 seek=100 conv=notrunc 2>/dev/null; printf y | dd of=server.tar.zst bs=1 seek=101 conv=notrunc 2>/dev/null'
expect 'a file without its seal fails' fail 'came with no server.tar.zst.seal' 'rm server.tar.zst.seal'
expect 'a seal without its file fails, naming the artifact' fail 'artifact ci-stack-server: server.tar.zst is missing' 'rm server.tar.zst'
expect 'an empty seal fails' fail 'is not a seal' ': > server.tar.zst.seal'

if seal_artifact "$work/absent" ci-stack-server 2>/dev/null; then
  echo "FAIL  sealing a file that does not exist succeeded"; failures=$((failures + 1))
else
  echo "ok    sealing a file that does not exist fails"
fi

[ "$failures" -eq 0 ] || { echo "$failures check(s) failed"; exit 1; }
echo "all artifact-seal checks passed"
