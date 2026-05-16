# UI Development Container with HMR Support
FROM node:20-alpine AS dev

WORKDIR /app

# Copy package.json only (not package-lock.json to avoid platform-specific deps)
COPY citadel-workspaces/package.json ./
RUN npm install --package-lock-only && npm install

# Note: Configuration files (vite.config.ts, tsconfig.json, etc.)
# are mounted via volumes at runtime, not copied at build time.
# This allows hot-reloading of config changes during development.

# Enable file watching for HMR
# Polling is required for Docker volume mounts to detect file changes
ENV CHOKIDAR_USEPOLLING=true
ENV CHOKIDAR_INTERVAL=100
ENV NODE_ENV=development

# Run as non-root user for security hardening
# Use GID/UID 1001 to avoid conflicts with Alpine's default GID 1000
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser && \
    chown -R appuser:appgroup /app
USER appuser

# Pre-create Vite cache directory AFTER switching to non-root user
# This ensures the named volume inherits appuser ownership on first mount
RUN mkdir -p /app/node_modules/.vite/deps

# Expose Vite dev server port
EXPOSE 5291

# Start Vite dev server with Docker-specific configuration
CMD ["npm", "run", "dev:docker"]

# ==============================================================================
# Production build stage
# ==============================================================================
FROM node:20-alpine AS build

WORKDIR /app

# Stage local file: dependencies into /workspace. Both packages have
# `main`/`exports` pointing at `dist/index.js`, so they have to be
# tsc-built BEFORE the UI's `npm install` copies them into node_modules —
# Vite's resolver fails the production build with "Failed to resolve
# entry for package … incorrect main/module/exports" otherwise.
COPY citadel-workspace-client-ts /workspace/citadel-workspace-client-ts
COPY citadel-internal-service/typescript-client /workspace/citadel-internal-service-wasm-client

# `citadel-workspace-client-ts/package.json` references the wasm client
# via `file:../citadel-internal-service/typescript-client`, which only
# resolves outside this flattened /workspace/ layout. Rewrite it so the
# wasm client is installed from the sibling /workspace path.
RUN sed -i 's|file:../citadel-internal-service/typescript-client|file:/workspace/citadel-internal-service-wasm-client|' /workspace/citadel-workspace-client-ts/package.json

# Build wasm client (innermost dep) first, then workspace client (which
# depends on it). Both produce dist/ so subsequent installs see the
# entry points declared in their package.json.
WORKDIR /workspace/citadel-internal-service-wasm-client
RUN npm install && npm run build

WORKDIR /workspace/citadel-workspace-client-ts
RUN npm install && npm run build

# Now build the UI itself.
WORKDIR /app
COPY citadel-workspaces/package.json ./

# Rewrite the UI's file: references the same way so they point at the
# already-built /workspace/ packages.
RUN sed -i 's|file:../citadel-internal-service/typescript-client|file:/workspace/citadel-internal-service-wasm-client|' package.json && \
    sed -i 's|file:../citadel-workspace-client-ts|file:/workspace/citadel-workspace-client-ts|' package.json

RUN npm install --package-lock-only && npm install

# Copy the full UI source tree
COPY citadel-workspaces/ ./

# Build for production
ENV NODE_ENV=production
RUN npm run build

# ==============================================================================
# Production serve stage - static files via nginx, non-root.
#
# Why not the default `nginx:stable-alpine` user model: that image
# starts the master process as root so it can bind to port 80, then
# forks workers that drop to `nginx`. The master staying root is a
# blast-radius hazard — a vulnerability in the master could yield
# root inside the container, which the rest of this PR's services
# (citadel-workspace-internal-service, server-kernel) avoid by
# running as `appuser` with no privileged-port binding. To match
# that posture we listen on 8080 (above 1024, so no root needed),
# chown the writable nginx state directories to the `nginx` user,
# and switch to that user before starting the daemon. Operators
# expose port 80 / 443 externally via the surrounding reverse proxy
# (Cloudflare tunnel in this repo) — the container internal port
# does not need to be 80.
# ==============================================================================
FROM nginx:stable-alpine AS production

# Copy the built static assets from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

# nginx ships with default config files that assume the master runs
# as root and write logs / pid / cache under root-owned paths. Re-own
# them to the unprivileged `nginx` user (uid 101, present in the
# base image) and drop the default config so our custom one below
# is the only server block.
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx \
    && touch /var/run/nginx.pid \
    && chown nginx:nginx /var/run/nginx.pid \
    && rm -f /etc/nginx/conf.d/default.conf

# Custom nginx config for SPA routing (all routes -> index.html).
#
# Security headers note: nginx `add_header` does NOT inherit across
# nesting levels — if a `location` block declares its own `add_header`,
# it silently replaces ALL inherited headers from the parent `server`
# block. So the security headers below must be repeated in every
# `location` block that also adds Cache-Control. Verbose, but explicit
# and correct; alternatives (sub-include files, `more_set_headers` from
# nginx-extras) require either extra build wiring or a non-stable
# nginx variant.
#
# CSP rationale:
#   * `script-src 'self' 'wasm-unsafe-eval'` — WASM compilation
#     (WebAssembly.compile / instantiate) is blocked by default CSP
#     unless `'wasm-unsafe-eval'` is granted. The Citadel WASM client
#     will fail to initialise without it.
#   * `style-src 'self' 'unsafe-inline'` — Vite/React + several Radix
#     UI components emit inline styles for layout/measurement.
#   * `img-src 'self' data:` — small inline icons use data: URLs.
#   * `connect-src 'self' ws: wss:` — WebSocket to the internal
#     service and workspace server is the app's primary transport.
RUN printf 'server {\n\
    listen 8080;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
\n\
    # Gzip compression\n\
    gzip on;\n\
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript application/wasm;\n\
    gzip_vary on;\n\
    gzip_min_length 256;\n\
\n\
    # Security headers (server-level; re-emitted in any location that\n\
    # also calls add_header — see comment above).\n\
    add_header X-Frame-Options "SAMEORIGIN" always;\n\
    add_header X-Content-Type-Options "nosniff" always;\n\
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;\n\
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;\n\
    add_header Content-Security-Policy "default-src '\''self'\''; script-src '\''self'\'' '\''wasm-unsafe-eval'\''; style-src '\''self'\'' '\''unsafe-inline'\''; img-src '\''self'\'' data:; font-src '\''self'\'' data:; connect-src '\''self'\'' ws: wss:; worker-src '\''self'\'' blob:; frame-ancestors '\''self'\''; base-uri '\''self'\''; form-action '\''self'\''" always;\n\
\n\
    # Cache static assets aggressively (hashed filenames from Vite)\n\
    location /assets/ {\n\
        expires 1y;\n\
        add_header Cache-Control "public, immutable" always;\n\
        add_header X-Frame-Options "SAMEORIGIN" always;\n\
        add_header X-Content-Type-Options "nosniff" always;\n\
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;\n\
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;\n\
        add_header Content-Security-Policy "default-src '\''self'\''; script-src '\''self'\'' '\''wasm-unsafe-eval'\''; style-src '\''self'\'' '\''unsafe-inline'\''; img-src '\''self'\'' data:; font-src '\''self'\'' data:; connect-src '\''self'\'' ws: wss:; worker-src '\''self'\'' blob:; frame-ancestors '\''self'\''; base-uri '\''self'\''; form-action '\''self'\''" always;\n\
    }\n\
\n\
    # WASM files\n\
    location ~* \\.wasm$ {\n\
        types { application/wasm wasm; }\n\
        expires 1y;\n\
        add_header Cache-Control "public, immutable" always;\n\
        add_header X-Frame-Options "SAMEORIGIN" always;\n\
        add_header X-Content-Type-Options "nosniff" always;\n\
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;\n\
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;\n\
        add_header Content-Security-Policy "default-src '\''self'\''; script-src '\''self'\'' '\''wasm-unsafe-eval'\''; style-src '\''self'\'' '\''unsafe-inline'\''; img-src '\''self'\'' data:; font-src '\''self'\'' data:; connect-src '\''self'\'' ws: wss:; worker-src '\''self'\'' blob:; frame-ancestors '\''self'\''; base-uri '\''self'\''; form-action '\''self'\''" always;\n\
    }\n\
\n\
    # SPA fallback - serve index.html for all non-file routes\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

USER nginx
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
