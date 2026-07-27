#!/bin/sh
#
# Validate the three runtime variables BEFORE envsubst renders them into the nginx config.
#
# WHY THIS EXISTS
#
# envsubst substitutes these values into the config file verbatim, so any character that means
# something to nginx's parser is an injection vector. Demonstrated on the unvalidated image:
#
#   AGENT_UPSTREAM='127.0.0.1:12345/; return 200 "INJECTED"; #'
#
# renders `proxy_pass http://127.0.0.1:12345/; return 200 "INJECTED"; #/;` - and nginx STARTS,
# because the `;` closed the directive and the rest became real configuration. The same trick works
# through WS_PROXY_ENABLED and LISTEN_ADDR, which land inside a quoted `set` and a `listen`.
#
# Whoever sets these variables is largely trusted - if you can set env on the container you can
# usually replace the image - so this is defence in depth rather than a boundary. But it is the
# same reasoning that makes NGINX_ENVSUBST_FILTER worth pinning: an environment variable should
# configure the proxy, never rewrite it. It also turns a class of operator typo (a stray scheme, a
# trailing slash, a full URL) into a loud startup failure instead of a subtly wrong proxy.
#
# Runs at 16 so it lands after the base image's own 10-/15- scripts and BEFORE
# 20-envsubst-on-templates.sh, i.e. before the values reach the config.

set -eu

die() {
  echo "[validate-runtime-vars] FATAL: $1" >&2
  echo "[validate-runtime-vars] refusing to start rather than render an unvalidated config." >&2
  exit 1
}

# host:port - a DNS name, IPv4 literal, or docker service name, plus a numeric port. Deliberately
# strict: no scheme, no path, no whitespace, no shell or nginx metacharacters.
upstream="${AGENT_UPSTREAM:-}"
[ -n "$upstream" ] || die "AGENT_UPSTREAM is empty."
echo "$upstream" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?:[0-9]{1,5}$' \
  || die "AGENT_UPSTREAM='$upstream' is not a bare host:port (e.g. 127.0.0.1:12345 or agent:12345). A scheme, path, or punctuation is rejected because this value is substituted directly into proxy_pass."

# Checked for INJECTION SAFETY only - deliberately NOT restricted to {0,1}.
#
# The config is opt-in: anything that is not exactly "1" disables the proxy. That is the documented
# fail-closed behaviour and it is what makes `WS_PROXY_ENABLED=false` safe rather than surprising.
# Demanding 0-or-1 here would turn that into a container that refuses to boot, so an operator who
# wrote the intuitive "false" would get a dead UI instead of a working one with the proxy off -
# trading a good failure mode for a worse one.
#
# So allow any benign token and let the config decide, while blocking the characters that would let
# this value escape its quoted `set` directive and become configuration.
enabled="${WS_PROXY_ENABLED:-}"
case "$enabled" in
  *[\"\;\$\\]* | *"'"* )
    die "WS_PROXY_ENABLED contains a character that could break out of the nginx directive it is substituted into. Use a plain token such as 1 or 0." ;;
esac
case "$enabled" in
  *[!A-Za-z0-9_-]* )
    die "WS_PROXY_ENABLED='$enabled' must be a plain alphanumeric token (1 enables the proxy; anything else disables it)." ;;
esac

# An IP literal to bind. Not a hostname: this goes into `listen`, which wants an address.
listen_addr="${LISTEN_ADDR:-}"
echo "$listen_addr" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$|^\[[0-9A-Fa-f:]+\]$' \
  || die "LISTEN_ADDR='$listen_addr' must be an IPv4 address (e.g. 0.0.0.0 or 127.0.0.1) or a bracketed IPv6 address."

echo "[validate-runtime-vars] ok: upstream=$upstream ws_proxy=$enabled listen=$listen_addr"
