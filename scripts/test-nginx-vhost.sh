#!/usr/bin/env bash
#
# The rendered tenant vhost must be accepted by the nginx that will load it. Two versions
# matter: 1.18 (Ubuntu's, on avarok2, where `http2 on;` was an unknown directive and the
# vhost could not be enabled) and 1.30 (the UI image's base). Rendered with and without a
# loopback directory, then `nginx -t` inside each official image with a throwaway
# certificate mounted where the vhost expects Let's Encrypt's.
#
# Usage: scripts/test-nginx-vhost.sh   (from the repo root; needs docker and openssl)
set -euo pipefail
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
fail() { echo "::error::$*"; exit 1; }
DOMAIN=w.example
mkdir -p "$WORK/le" "$WORK/loopback"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout "$WORK/le/privkey.pem" -out "$WORK/le/fullchain.pem" -subj "/CN=$DOMAIN" -days 1 >/dev/null 2>&1
bash scripts/render-nginx-vhost.sh "$DOMAIN" 12402 t "/srv/citadel-tenants/t/loopback" > "$WORK/with.conf"
bash scripts/render-nginx-vhost.sh "$DOMAIN" 12402 t > "$WORK/without.conf"
grep -q '/agent/loopback' "$WORK/with.conf"    || fail "the vhost with a loopback dir has no /agent/ location"
grep -q '/agent/' "$WORK/without.conf" && fail "the vhost without a loopback dir has an /agent/ location"
passes=0
for image in nginx:1.18-alpine nginx:1.30-alpine; do
  for conf in with without; do
    out=$(docker run --rm --platform linux/amd64 \
      -v "$WORK/$conf.conf:/etc/nginx/conf.d/$DOMAIN.conf:ro" \
      -v "$WORK/le:/etc/letsencrypt/live/$DOMAIN:ro" \
      -v "$WORK/loopback:/srv/citadel-tenants/t/loopback:ro" \
      "$image" nginx -t 2>&1) || { echo "$out" | tail -3; fail "$image rejected the vhost rendered $conf a loopback dir"; }
    passes=$((passes+1))
  done
  echo "  $image accepts the vhost, with and without the loopback location"
done
echo "nginx-vhost: all $passes renders accepted."
