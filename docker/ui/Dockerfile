# UI Development Container with HMR Support
FROM node:20-alpine AS dev

WORKDIR /app

# Copy package.json only (not package-lock.json to avoid platform-specific deps)
COPY citadel-workspaces/package.json ./
# Retried, because this resolves dependency RANGES against the live registry on
# every build rather than installing a committed lockfile.
#
# That makes the build inherit whatever npm published minutes ago. Observed
# 2026-08-24: `typescript-eslint: "^8.20.0"` resolved to a freshly released
# 8.68.0 whose sibling `@typescript-eslint/parser@8.68.0` had not propagated
# yet, so five integration jobs died with ETARGET at `Start Services` — before
# the test step, which is then SKIPPED, leaving a red job with no test output
# and nothing wrong with anyone's code.
#
# A monorepo publish race resolves within minutes, so a bounded retry converts a
# hard failure into a slower success. It does NOT make the build reproducible:
# the real fix is installing the committed lockfile, which is blocked twice over
# — this is an npm WORKSPACE, so the lockfile lives at the repo root and covers
# every package, and citadel-workspaces/package.json carries two `file:` deps
# pointing outside its own directory. Installing it here would mean copying the
# root manifest, every workspace manifest and both file: targets, then rewriting
# their paths — which is what the production stage does with `sed`, and that
# rewriting is exactly what invalidates a lockfile. Retrying is the mitigation,
# not the cure.
#
# Five attempts, not three. Observed 2026-08-26: `@tanstack/react-query@5.102.5`
# published requiring `@tanstack/query-core@5.102.5`, which had not propagated.
# Three attempts spend ~2 minutes total and all five jobs depending on this
# image went red — the shards and two integration tests — with nothing wrong in
# any of them. The version was available shortly afterwards. Five attempts spend
# ~5 minutes, which covers the races seen so far without letting a genuinely
# missing dependency hang the build indefinitely.
RUN for attempt in 1 2 3 4 5; do \
      npm install --package-lock-only && npm install && break; \
      echo "npm install failed (attempt $attempt/5); registry may be mid-publish, retrying in $((attempt * 20))s"; \
      sleep $((attempt * 20)); \
    done; \
    npm ls --depth=0 >/dev/null 2>&1 || npm install

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

# LEAVE THIS EMPTY. It exists only as an escape hatch, and setting it re-breaks the
# thing this image was fixed to do.
#
# The app now derives its WebSocket URL from `window.location` at runtime, reaching the
# agent through the same-origin `/ws` proxy below. That is what lets ONE published image
# serve every topology. Baking an absolute URL in here pins the image to a single
# deployment - and an OFF-ORIGIN one is blocked outright by the production CSP
# (`connect-src 'self'`), which is the exact bug this replaced: the app appeared to work
# in dev, whose CSP was laxer, and could not connect at all once built.
#
# Only a SAME-ORIGIN value (`wss://yourdomain.com/ws`) can work, and that is precisely
# what the runtime default already produces - so there is no reason to set it. CI passes
# no build-arg deliberately.
ARG VITE_WS_URL=
ENV VITE_WS_URL=${VITE_WS_URL}

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
# Retried, like the two `npm install`s above and for the same reason: this
# image has no lockfile here, so every build re-resolves against the live
# registry and a publish race or a reset connection is a red job with no test
# output. The loop was written twice in this file and these two were left bare.
WORKDIR /workspace/citadel-internal-service-wasm-client
RUN for attempt in 1 2 3 4 5; do \
      npm install && break; \
      echo "npm install failed (attempt $attempt/5); registry may be mid-publish, retrying in $((attempt * 20))s"; \
      sleep $((attempt * 20)); \
    done; \
    npm run build

WORKDIR /workspace/citadel-workspace-client-ts
RUN for attempt in 1 2 3 4 5; do \
      npm install && break; \
      echo "npm install failed (attempt $attempt/5); registry may be mid-publish, retrying in $((attempt * 20))s"; \
      sleep $((attempt * 20)); \
    done; \
    npm run build

# Now build the UI itself.
WORKDIR /app
COPY citadel-workspaces/package.json ./

# Rewrite the UI's file: references the same way so they point at the
# already-built /workspace/ packages.
RUN sed -i 's|file:../citadel-internal-service/typescript-client|file:/workspace/citadel-internal-service-wasm-client|' package.json && \
    sed -i 's|file:../citadel-workspace-client-ts|file:/workspace/citadel-workspace-client-ts|' package.json

# Same retry, same window, same reason — see the build stage above. Widened
# with it: leaving this at three would have kept the Production Docker Build
# exposed to exactly the race that took out the other five jobs, while the
# comment above claimed they matched.
RUN for attempt in 1 2 3 4 5; do \
      npm install --package-lock-only && npm install && break; \
      echo "npm install failed (attempt $attempt/5); registry may be mid-publish, retrying in $((attempt * 20))s"; \
      sleep $((attempt * 20)); \
    done; \
    npm ls --depth=0 >/dev/null 2>&1 || npm install

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
# Pinned to a minor line, not the moving `stable-alpine` tag. This image's behaviour depends on
# the base's envsubst entrypoint (NGINX_ENVSUBST_FILTER), so an upstream major bump could change
# how the config renders. The smoke test asserts the rendered output, so such a break would fail
# the build rather than ship - but a deterministic base means it fails when we bump it, not at a
# random hour because upstream moved a tag. Patch releases still flow in.
FROM nginx:1.30-alpine AS production

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

# nginx config lives in docker/ui/nginx.conf.template and is rendered at CONTAINER
# START by the nginx image's envsubst entrypoint, not baked in at build time.
#
# WHY IT IS A TEMPLATE: the config now proxies `/ws` to the Citadel agent, and the
# agent sits somewhere different in each topology - 127.0.0.1 on host networking,
# a service name on a bridge network, host.docker.internal when it runs natively
# on the user's machine. Baking the upstream in would mean one image per topology,
# which defeats the point of publishing it to a registry. AGENT_UPSTREAM is
# therefore a RUNTIME setting with a sane default.
COPY docker/ui/nginx.conf.template /etc/nginx/templates/default.conf.template

# Validate the runtime variables before envsubst renders them. They are substituted into the
# config VERBATIM, so a value containing `;` injects real nginx directives - demonstrated with
# AGENT_UPSTREAM='127.0.0.1:12345/; return 200 "x"; #', which nginx accepted and started on.
# Numbered 16 so it runs after the base image's own scripts and before 20-envsubst-on-templates.sh.
COPY docker/ui/16-validate-runtime-vars.sh /docker-entrypoint.d/16-validate-runtime-vars.sh
RUN chmod +x /docker-entrypoint.d/16-validate-runtime-vars.sh
# Sourced by the entrypoint between validation (16-) and rendering (20-): defaults the one
# OPTIONAL runtime variable to empty, because envsubst substitutes only variables present in
# the environment and nginx refuses a config with the literal `${LOOPBACK_AGENT_ORIGIN}` left in.
COPY docker/ui/17-default-runtime-vars.envsh /docker-entrypoint.d/17-default-runtime-vars.envsh
# The entrypoint sources an .envsh only if it is executable, and IGNORES it otherwise -- a
# file that is merely present changes nothing, silently.
RUN chmod +x /docker-entrypoint.d/17-default-runtime-vars.envsh

# Where the agent lives. Default suits host networking (and the dev stack). Override
# with `-e AGENT_UPSTREAM=internal-service:12345` on a bridge network, or
# `host.docker.internal:12345` for an agent running natively on the host.
ENV AGENT_UPSTREAM=127.0.0.1:12345

# Whether /ws proxies to the agent at all. DEFAULTS TO OFF - the image FAILS CLOSED.
#
# The agent's socket is an UNAUTHENTICATED control plane, and an Origin check cannot
# protect it from a non-browser client that simply forges the header. So the blast
# radius of a permissive default is: anyone who runs this image in a topology we did
# not anticipate - `docker run --network host`, a bridge run with `-p 8080:8080`,
# behind someone else's ingress - silently republishes that control plane to whoever
# can reach the port. An image cannot know which of those it is in.
#
# So the deployment declares its intent instead of inheriting it. docker-compose.local.yml
# sets this to 1 because there the UI is loopback-bound and the proxy is both safe and
# required; every other topology gets no proxy unless it asks. A wrong default here is a
# security hole, whereas a wrong default the other way is a visible 404.
# See the SECURITY note in nginx.conf.template.
ENV WS_PROXY_ENABLED=0

# Address nginx binds. 0.0.0.0 is right for a bridge-networked container (`-p 8080:8080`
# cannot reach a loopback bind). Under HOST networking it would publish /ws to the LAN,
# so docker-compose.local.yml overrides this to 127.0.0.1.
ENV LISTEN_ADDR=0.0.0.0

# Pin envsubst to exactly these three names.
#
# The entrypoint builds its substitution list from the names of REAL environment
# variables, so nginx's own `$http_upgrade` / `$connection_upgrade` are not at risk
# merely because the filter is absent - verified by rendering both ways. What the
# filter actually prevents is a COLLISION: without it, every environment variable is
# eligible, so an env var whose name happens to match an nginx variable rewrites the
# config. Demonstrated - running the unfiltered image with `-e host=pwned` renders
# `proxy_set_header Host pwned;`, while the filtered image keeps `$host`.
#
# That makes this an injection guard: whoever can set env vars on the container could
# otherwise alter the proxy's behaviour, including the headers it forwards. The smoke
# test asserts the property directly by starting the image with a colliding variable.
ENV NGINX_ENVSUBST_FILTER=^(AGENT_UPSTREAM|WS_PROXY_ENABLED|LISTEN_ADDR|LOOPBACK_AGENT_ORIGIN)$

# The entrypoint renders templates into /etc/nginx/conf.d at start-up, and we run as
# the unprivileged `nginx` user - so that directory must be writable by it. Without
# this the container starts, fails to write the rendered config, and serves nothing.
RUN chown -R nginx:nginx /etc/nginx/conf.d

USER nginx
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
