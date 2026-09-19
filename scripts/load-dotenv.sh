#!/usr/bin/env bash
# Sourced by deploy.sh; tested by scripts/test-load-dotenv.sh.
#
# We parse `.env` line-by-line rather than `source .env`. `source` runs the
# file as a shell script, so backticks, `$()`, unquoted spaces, etc. in a
# value get evaluated by the shell — convenient for advanced users but a
# silent-misconfiguration footgun for the common case where an operator
# pasted `WORKSPACE_MASTER_PASSWORD=$(date +%s)` expecting docker-compose
# to receive that literal string. This loop skips comments and blank lines,
# strips matching surrounding quotes, and exports verbatim — matching what
# docker-compose itself does with `.env`.
#
# Usage: load_dotenv <file>
load_dotenv() {
    local key value from_file=" "
    while IFS='=' read -r key value; do
        # Strip trailing CR so a `.env` created on Windows / transferred via
        # FTP doesn't bake a literal "\r" into every value — that's a
        # very-hard-to-diagnose auth failure for WORKSPACE_MASTER_PASSWORD
        # (server gets "secret\r", operator types "secret"). docker-compose
        # handles CRLF natively; this parser now matches.
        key="${key%$'\r'}"
        value="${value%$'\r'}"
        [[ "$key" =~ ^[[:space:]]*# ]] && continue
        [[ -z "${key// /}" ]] && continue
        # Trim leading/trailing whitespace on the value. If the operator
        # wrote `KEY = value` (with spaces around `=`), `IFS='='` gives
        # value=" value", and the unquoted-export below would bake the
        # leading space into the env var. Any shell consumer probing
        # `${VAR}` then sees " value" (with leading space) — a `nc -z`
        # against ` 12346` rather than `12346` would time out with a
        # confusing "port not bound" error. Trim BEFORE the quote-strip
        # so `KEY = "value"` lands the same as `KEY="value"`.
        value="${value#"${value%%[![:space:]]*}"}"
        value="${value%"${value##*[![:space:]]}"}"
        # Strip matching outer quotes (single OR double) — docker-compose's
        # env-file loader does the same so wrapped values land identically.
        if [[ "$value" =~ ^\"(.*)\"$ ]] || [[ "$value" =~ ^\'(.*)\'$ ]]; then
            value="${BASH_REMATCH[1]}"
        fi
        # `export "K=$value"` does NOT re-evaluate `$()` or backticks inside
        # `$value` — parameter expansion happens once and the resulting
        # characters become the literal exported value. Verified with
        # `value='$(date +%s)' export "K=$value" && echo "$K"` → prints
        # `$(date +%s)` literally, not the timestamp. A previous review
        # flagged this as a re-evaluation risk; it isn't, but the test
        # above is worth keeping in mind for any future refactor.
        key="${key// /}"
        # A variable the caller exported wins over `.env`, as it does in docker
        # compose itself. Exporting over it made the documented rollback,
        # `IMAGE_TAG=sha-... ./deploy.sh --no-pull`, silently redeploy the tag in
        # `.env` -- which provision-tenant.sh always writes -- while the revision
        # gate passed, because the images it pulled agreed with each other.
        # printenv, not ${!key+x}: deploy.sh's own unexported variables (e.g.
        # COMPOSE_FILE) must not start shadowing `.env`. A key this file set
        # earlier is not the caller's: a repeated key's last value wins, as in
        # compose.
        if [[ "$from_file" != *" $key "* ]] && printenv "$key" >/dev/null 2>&1; then
            continue
        fi
        from_file+="$key "
        export "$key=$value"
    done < "$1"
}
