#!/usr/bin/env bash
# Fails if the deployment docs name an environment variable nothing reads.
#
# A deployment doc is the one place a reader cannot verify a claim by running
# it. This one had drifted in both directions at once: it described the
# workspace server's loopback bind as "remaining work" long after
# WORKSPACE_BIND_ADDR shipped, so the doc reported an unguarded attack surface
# that was in fact guarded.
#
# The dangerous direction is the other one: a doc naming a variable nothing
# consumes reads as a security control you can switch on. Set it, and the
# service keeps its default while the runbook says it is locked down.
#
# Consumers are legitimately spread across Rust (std::env::var), Dockerfile CMD
# lines, compose files and workflows, so the check is "referenced anywhere
# outside docs/" rather than anything narrower.
set -euo pipefail

cd "$(dirname "$0")/.."

DOCS=(docs/PRODUCTION_DEPLOYMENT.md README.md)
missing=0

for doc in "${DOCS[@]}"; do
  [ -f "$doc" ] || continue

  # Env-var-shaped tokens inside backticks: SCREAMING_SNAKE, at least one
  # underscore. The underscore requirement drops prose like `IMPORTANT`.
  vars=$(grep -oE '`[A-Z][A-Z0-9]*(_[A-Z0-9]+)+' "$doc" | tr -d '`' | sort -u || true)

  for var in $vars; do
    if ! grep -rqI --exclude-dir=docs --exclude-dir=.git --exclude-dir=node_modules \
                   --exclude-dir=target --exclude='*.md' "$var" . 2>/dev/null; then
      echo "  $doc names \`$var\` but nothing in the repo reads it."
      missing=$((missing + 1))
    fi
  done
done

if [ "$missing" -gt 0 ]; then
  echo
  echo "$missing documented environment variable(s) have no consumer."
  echo "Either wire the variable up, or stop documenting it — a setting that"
  echo "silently does nothing is worse than one that is absent."
  exit 1
fi

echo "Documented environment variables all have consumers."
