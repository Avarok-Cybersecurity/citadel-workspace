#!/usr/bin/env bash
#
# The UI image's runtime configuration, tested WITHOUT the image: the validator that runs
# before nginx renders anything, and the rendered template itself.
#
# Two things have to hold. LOOPBACK_AGENT_ORIGIN is substituted into a quoted nginx string
# (the CSP) and into an HTML attribute (the page meta), so the validator must admit only a
# bare wss://host:port -- a value that reaches the template is configuration, and a quote or
# semicolon in it is an injection. And the CSP is defined once, as a map: every location
# must reference it, and the origin must land in connect-src and in the meta, from the same
# variable, so what the app dials and what the policy permits cannot disagree.
#
# Usage: scripts/test-ui-runtime-config.sh   (from the repo root; needs envsubst from gettext)
set -euo pipefail
V=docker/ui/16-validate-runtime-vars.sh
T=docker/ui/nginx.conf.template
fails=0
passes=0
ok()   { echo "  ok: $1"; passes=$((passes+1)); }
bad()  { echo "  FAIL: $1"; fails=$((fails+1)); }
base=(AGENT_UPSTREAM=127.0.0.1:12345 WS_PROXY_ENABLED=0 LISTEN_ADDR=0.0.0.0)

accepts() { # <label> <LOOPBACK value or __unset__>
  local label="$1" val="$2"; local -a e=("${base[@]}")
  [ "$val" = "__unset__" ] || e+=("LOOPBACK_AGENT_ORIGIN=$val")
  if env -i "${e[@]}" sh "$V" >/dev/null 2>&1; then ok "validator accepts $label"; else bad "validator refused $label"; fi
}
refuses() { # <label> <LOOPBACK value>
  if env -i "${base[@]}" "LOOPBACK_AGENT_ORIGIN=$2" sh "$V" >/dev/null 2>&1; then bad "validator ACCEPTED $1"; else ok "validator refuses $1"; fi
}
accepts "no loopback origin"              __unset__
accepts "an empty loopback origin"        ""
accepts "a bare wss origin"               "wss://local.example.com:12345"
refuses "a plain ws scheme"               "ws://local.example.com:12345"
refuses "a path on the origin"            "wss://local.example.com:12345/ws"
refuses "a missing port"                  "wss://local.example.com"
refuses "an nginx string breakout"        'wss://local.example.com:12345"; return 200 "X"; #'
refuses "an HTML attribute breakout"      'wss://local.example.com:12345"><script>'
refuses "a semicolon (CSP directive end)" "wss://local.example.com:12345; default-src *"
refuses "an uppercase host"               "wss://Local.Example.com:12345"

# Mirror the nginx entrypoint exactly: 20-envsubst-on-templates.sh substitutes ONLY the
# variables PRESENT in the environment whose names match NGINX_ENVSUBST_FILTER, after sourcing
# every *.envsh in /docker-entrypoint.d. A test that hands envsubst a fixed variable list
# cannot see what an absent variable does -- and an absent one is left as the literal
# `${LOOPBACK_AGENT_ORIGIN}`, which nginx reads as its own undefined variable and dies on.
ENVSH=docker/ui/17-default-runtime-vars.envsh
FILTER='^(AGENT_UPSTREAM|WS_PROXY_ENABLED|LISTEN_ADDR|LOOPBACK_AGENT_ORIGIN)$'
render() { # [LOOPBACK value | __absent__] -> rendered config on stdout
  local -a e=("${base[@]}")
  [ "${1:-__absent__}" = "__absent__" ] || e+=("LOOPBACK_AGENT_ORIGIN=$1")
  # SKIP_ENVSH is the control's switch: it must cross env -i explicitly or the control cannot
  # skip anything and reads green for nothing.
  env -i PATH="$PATH" SKIP_ENVSH="${SKIP_ENVSH:-}" "${e[@]}" sh -c '
    [ -z "${SKIP_ENVSH:-}" ] && . "$1"
    defined=$(env | cut -d= -f1 | grep -E "$2" | sed "s/^/\${/; s/$/}/" | tr "\n" " ")
    envsubst "$defined" < "$3"' sh "$ENVSH" "$FILTER" "$T"
}
grep -q "17-default-runtime-vars.envsh /docker-entrypoint.d/17-default-runtime-vars.envsh" docker/ui/Dockerfile \
  && ok "the Dockerfile installs the default-variables envsh" || bad "the Dockerfile does not install 17-default-runtime-vars.envsh"
# Present is not enough: the nginx entrypoint sources an .envsh only when it is executable and
# otherwise ignores it. An image with the file copied and no chmod rendered the literal and
# died at start -- with this assertion green. It must see the exec bit being set.
grep -q "chmod +x /docker-entrypoint.d/17-default-runtime-vars.envsh" docker/ui/Dockerfile \
  && ok "the Dockerfile makes the envsh executable, which is what makes the entrypoint source it" || bad "the Dockerfile never chmods 17-default-runtime-vars.envsh; the entrypoint will ignore it"
[ "16-validate-runtime-vars.sh" \< "17-default-runtime-vars.envsh" ] && [ "17-default-runtime-vars.envsh" \< "20-envsubst-on-templates.sh" ] \
  && ok "the default is applied after validation and before rendering (16- < 17- < 20-)" || bad "17-default-runtime-vars.envsh does not sort between 16- and 20-"
rabs=$(render __absent__)
if echo "$rabs" | grep -q 'LOOPBACK_AGENT_ORIGIN'; then bad "with the variable ABSENT the literal \${LOOPBACK_AGENT_ORIGIN} survived into the config (nginx: unknown variable)"; else ok "absent variable renders as empty, not as a literal nginx variable"; fi
echo "$rabs" | grep -q "connect-src 'self' ;" && ok "absent variable leaves connect-src 'self' alone" || bad "absent variable changed connect-src"
r=$(render "wss://local.example.com:12345")
[ "$(echo "$r" | grep -c '^map \$host \$csp')" = "1" ] && ok "the CSP is defined once, as a map" || bad "the CSP map is missing or duplicated"
[ "$(echo "$r" | grep -cE 'add_header Content-Security-Policy "')" = "0" ] && ok "no location carries its own CSP string" || bad "a location still carries a literal CSP"
[ "$(echo "$r" | grep -c 'add_header Content-Security-Policy $csp always;')" -ge 6 ] && ok "every location references the map" || bad "fewer than six locations reference \$csp"
echo "$r" | grep -q "connect-src 'self' wss://local.example.com:12345;" && ok "the origin lands in connect-src" || bad "connect-src does not carry the origin"
echo "$r" | grep -q 'name="citadel-loopback-agent" content="wss://local.example.com:12345"' && ok "the origin lands in the page meta" || bad "the meta substitution does not carry the origin"
r0=$(render "")
echo "$r0" | grep -q "connect-src 'self' ;" && ok "empty origin leaves connect-src 'self' alone" || bad "empty origin changed connect-src"
echo "$r0" | grep -q 'content=""' && ok "empty origin leaves the meta empty" || bad "empty origin filled the meta"
# The validator runs BEFORE the template is rendered: the nginx image runs /docker-entrypoint.d
# in name order, and the envsubst step is 20-*. A validator named later would validate a config
# already written.
[ "$(basename "$V")" \< "20-envsubst-on-templates.sh" ] && ok "validator runs before envsubst (16- < 20-)" || bad "validator would run after envsubst"

if [ "$fails" -ne 0 ]; then echo "FAIL: $fails assertion(s)"; exit 1; fi
echo "ui-runtime-config: all $passes assertions passed."
