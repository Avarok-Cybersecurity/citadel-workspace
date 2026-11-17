#!/usr/bin/env bash
#
# Run legacy integration specs one at a time and print a compact verdict table.
#
#   ./scripts/run-specs.sh p2p-messaging file-manager
#   ./scripts/run-specs.sh group-chat/office-chat reconnection/c2s-reconnect
#
# Why this exists rather than `npm run test:all`: the specs share one backend and
# one dev server, so they cannot run in parallel, and a single long serial run is
# fragile — anything that interrupts it loses every result collected so far. Run
# them in batches of ~5 and partial progress survives.
#
# Each spec writes its full output to /tmp/spec-<name>.log; only the verdict is
# printed here, because these logs run to tens of thousands of lines.
#
# NO VERDICT means the process died before printing its OVERALL line — a crash,
# not a failed assertion. Read the tail of the log: an uncaught rejection inside
# a spec takes node down and discards results that were already collected.
#
set -uo pipefail

cd "$(dirname "$0")/.."

export IN_CI=true
export WORKSPACE_MASTER_PASSWORD="${WORKSPACE_MASTER_PASSWORD:-ci-test-password}"

# Per-spec timeout. The slowest specs exercise disconnect/reconnect timeouts and
# legitimately take over ten minutes.
TIMEOUT_SECONDS="${SPEC_TIMEOUT:-1800}"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <spec> [spec...]" >&2
  echo "  spec is a path under src/tests without the .test.ts suffix," >&2
  echo "  e.g. p2p-messaging or group-chat/office-chat" >&2
  exit 1
fi

echo "Building specs..."
if ! npm run build >/dev/null 2>&1; then
  echo "BUILD FAILED - run 'npm run build' to see why" >&2
  exit 1
fi

failed=0
for spec in "$@"; do
  entry="dist/tests/${spec}.test.js"
  if [ ! -f "$entry" ]; then
    printf '%-34s NO SUCH SPEC (%s)\n' "$spec" "$entry"
    failed=1
    continue
  fi

  # A spec name may contain a directory. Left as-is it would put the log inside a
  # directory that does not exist and silently fail the redirect, so flatten it.
  log="/tmp/spec-${spec//\//-}.log"

  timeout "$TIMEOUT_SECONDS" node "$entry" > "$log" 2>&1
  status=$?

  # -a because these logs contain binary from console captures, which otherwise
  # makes grep treat the whole file as binary and print nothing.
  verdict=$(grep -a -E '^OVERALL' "$log" | tail -1)

  case "$verdict" in
    *PASSED*) printf '%-34s PASS\n' "$spec" ;;
    *FAILED*) printf '%-34s FAIL   %s\n' "$spec" "$log"; failed=1 ;;
    *)
      if [ "$status" -eq 124 ]; then
        printf '%-34s TIMEOUT after %ss   %s\n' "$spec" "$TIMEOUT_SECONDS" "$log"
      else
        printf '%-34s NO VERDICT (exit %s)   %s\n' "$spec" "$status" "$log"
      fi
      failed=1
      ;;
  esac
done

exit "$failed"
