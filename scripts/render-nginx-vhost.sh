#!/usr/bin/env bash
# Render an nginx vhost for a tenant's UI.
#
# Split out of provision-tenant.sh to keep that file inside the repo's 250-line
# convention. One caller, no independent life.
#
# Usage: render-nginx-vhost.sh <domain> <ui-port> [tenant] [loopback-dir]
set -euo pipefail
DOMAIN="${1:?usage: render-nginx-vhost.sh <domain> <ui-port> [tenant] [loopback-dir]}"
UI_PORT="${2:?usage: render-nginx-vhost.sh <domain> <ui-port> [tenant] [loopback-dir]}"
# Named in the heredoc's comment line only; the caller does not pass it.
TENANT="${3:-this tenant}"
# The directory holding loopback.pem and loopback.key for the tenant's published
# loopback name (provision-tenant.sh --loopback-host). Served at /agent/ so each
# user's agent can fetch the current certificate at start: it is a ninety-day
# certificate, and an agent that carried its own would expire in the field. The
# key is public by construction -- the name resolves to 127.0.0.1 -- so serving
# it protects nothing that was protected and enables the only socket a hosted
# page may open. Empty: no such location.
LOOPBACK_DIR="${4:-}"

render_vhost() {
  cat <<EOF
# $DOMAIN -> tenant $TENANT UI on 127.0.0.1:$UI_PORT
server {
    listen 80; listen [::]:80;
    server_name $DOMAIN;
    return 301 https://\$server_name\$request_uri;
}
server {
    # \`http2\` as a listen parameter, not the \`http2 on;\` directive: the directive is nginx
    # 1.25.1+, and the host this runs on (avarok2) is Ubuntu's 1.18, where it is an unknown
    # directive and the vhost cannot be enabled at all. The parameter form works on both.
    listen 443 ssl http2; listen [::]:443 ssl http2;
    server_name $DOMAIN;
    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 500m;
    location / {
        proxy_pass http://127.0.0.1:$UI_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        # The UI reaches its agent over a WebSocket. Without these two the
        # connection is downgraded to a plain request and the app loads but
        # never connects -- which looks like an application bug, not an
        # ingress one, and is why they are here rather than left to a default.
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 180s;
        proxy_buffering off;
    }
EOF
  if [ -n "$LOOPBACK_DIR" ]; then
    cat <<EOF
    # The loopback certificate for the agent on each visitor's machine. Exactly the two
    # files, by name; no listing, no other file in the directory. no-cache, because a
    # renewed certificate must reach the next agent start, not a cached copy.
    location ~ ^/agent/loopback\.(pem|key)\$ {
        root $LOOPBACK_DIR;
        rewrite ^/agent/(.*)\$ /\$1 break;
        default_type application/x-pem-file;
        add_header Cache-Control "no-cache" always;
    }
EOF
  fi
  cat <<EOF
}
EOF
}
render_vhost
