#!/usr/bin/env bash
# Tests scripts/load-dotenv.sh, the `.env` loader deploy.sh sources.
#
# The case that matters most is the first: the documented rollback,
# `IMAGE_TAG=sha-... ./deploy.sh --no-pull`, was silently overridden by the
# IMAGE_TAG that provision-tenant.sh writes into every tenant's `.env`.
set -euo pipefail
cd "$(dirname "$0")/.."

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failures=0

# check <name> <expected> <command...>: run the command in a clean subshell that
# has sourced the loader, and compare what it prints.
check() {
    local name=$1 expected=$2; shift 2
    local got rc=0
    # A failing command must be reported as that check's failure, not end the
    # run: under `set -e` a bare failing substitution exits here, silently.
    got=$(env -i PATH="$PATH" bash -c '. ./scripts/load-dotenv.sh; '"$*") || rc=$?
    [ "$rc" -eq 0 ] || got="$got<exit $rc>"
    if [ "$got" = "$expected" ]; then
        echo "ok    $name"
    else
        echo "FAIL  $name: expected [$expected], got [$got]"
        failures=$((failures + 1))
    fi
}

printf 'IMAGE_TAG=latest\n' > "$work/tag.env"
check "a tag the caller exported beats the .env tag (the rollback)" "sha-abc123456789" \
    "export IMAGE_TAG=sha-abc123456789; load_dotenv $work/tag.env; echo \$IMAGE_TAG"
check "with no caller value, the .env tag is used" "latest" \
    "load_dotenv $work/tag.env; echo \$IMAGE_TAG"
check "a caller's exported empty value still wins, as in compose" "[]" \
    "export IMAGE_TAG=; load_dotenv $work/tag.env; echo [\$IMAGE_TAG]"
check "an UNexported shell variable does not shadow .env" "latest" \
    "IMAGE_TAG=from-the-script; load_dotenv $work/tag.env; printenv IMAGE_TAG"

printf 'PORT=1\nPORT=2\n' > "$work/repeat.env"
check "a key repeated in .env takes its last value" "2" \
    "load_dotenv $work/repeat.env; echo \$PORT"

# What the loader already did, which moving it must not change.
printf 'A=crlf\r\n# a comment\n\nB = "quoted"\nC='"'"'$(date +%%s)'"'"'\nD = spaced \n' > "$work/format.env"
check "a trailing CR is stripped" "crlf" "load_dotenv $work/format.env; echo \$A"
check "spaces around = and matching quotes are stripped" "quoted" "load_dotenv $work/format.env; echo \$B"
check "\$(...) in a value stays literal" '$(date +%s)' "load_dotenv $work/format.env; printenv C"
check "an unquoted value is trimmed" "spaced" "load_dotenv $work/format.env; echo \"\$D\""
check "comments and blank lines set nothing" "" \
    "load_dotenv $work/format.env; env | grep -E '^(#| )' || true"

if [ "$failures" -gt 0 ]; then
    echo "$failures load-dotenv check(s) failed"
    exit 1
fi
echo "load-dotenv: all checks passed"
