#!/usr/bin/env bash
# Render an nginx vhost for a tenant's UI.
#
# Split out of provision-tenant.sh to keep that file inside the repo's 250-line
# convention. One caller, no independent life.
#
# Usage: render-nginx-vhost.sh <domain> <ui-port>
set -euo pipefail
DOMAIN="${1:?usage: render-nginx-vhost.sh <domain> <ui-port>}"
UI_PORT="${2:?usage: render-nginx-vhost.sh <domain> <ui-port>}"
# Named in the heredoc's comment line only; the caller does not pass it.
TENANT="${3:-this tenant}"

render_vhost() {
  cat <<EOF
# $DOMAIN -> tenant $TENANT UI on 127.0.0.1:$UI_PORT
server {
    listen 80; listen [::]:80;
    server_name $DOMAIN;
    return 301 https://\$server_name\$request_uri;
}
server {
    listen 443 ssl; listen [::]:443 ssl;
    server_name $DOMAIN;
    http2 on;
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
}
EOF
}
render_vhost
