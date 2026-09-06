# syntax=docker.io/docker/dockerfile:1.7-labs
# =============================================================================
# Internal Service (the "citadel agent") image.
#
# Stages:
#   builder     - full Rust toolchain; compiles the release binary
#   production  - slim runtime: the ~29 MB binary + its shared libs, nothing else
#   dev         - LAST stage, and therefore the DEFAULT build target
#
# STAGE ORDER IS LOAD-BEARING. `docker build` with no `--target` builds the LAST
# stage, and `docker-compose.yml` (dev / tilt / CI integration tests) does NOT
# pin a target for this service. If `production` were last, dev and CI would
# silently get a toolchain-less image. `dev` therefore stays last and is
# equivalent to the previous single-stage image.
#
# The slim stage matters most for THIS image: end users run the agent locally,
# so they would otherwise each pull 4.43 GB just to launch the app. `ldd` on the
# binary reports the same seven libs as the workspace server, and notably NO
# GTK/GDK linkage despite the `rfd` dependency -- so no desktop stack is needed.
# The slim stage lands at roughly 150 MB.
# =============================================================================

FROM rust:1.92.0 AS builder

WORKDIR /usr/src/app

# Skip WASM build in Docker environment
ENV SKIP_WASM_BUILD=1
ENV DOCKER_CONTAINER=1

# Install necessary build dependencies for crates like oqs-sys (which uses bindgen)
RUN apt-get update && \
    apt-get install -y cmake libclang-dev llvm clang net-tools netcat-openbsd curl && \
    rm -rf /var/lib/apt/lists/*

COPY ./docker/workspace-server/kernel.toml /usr/src/app/kernel.toml
COPY ./Cargo.toml /usr/src/app/Cargo.toml
# The lockfile, or this image is not building what the repository says.
#
# `citadel_sdk` is a git dependency on `branch = "master"` (Cargo.toml), and
# without the lock cargo re-resolves it to master's TIP at image build time. So
# the same workspace commit built twice can produce two different binaries, and
# a change merged to the protocol repo reaches this image with no change here and
# no signal anywhere. That is not hypothetical: a protocol merge landed between
# two CI runs of one unchanged branch and turned an integration test red.
#
# With the lock present cargo keeps the recorded revision, so upgrading the
# protocol becomes what it should be — an explicit, reviewable commit that moves
# Cargo.lock.
COPY ./Cargo.lock /usr/src/app/Cargo.lock
COPY ./citadel-workspace-server-kernel /usr/src/app/citadel-workspace-server-kernel
COPY ./citadel-workspace-internal-service /usr/src/app/citadel-workspace-internal-service
COPY ./citadel-workspace-types /usr/src/app/citadel-workspace-types
# A workspace member. Cargo loads EVERY member's manifest before building any
# of them, so omitting a crate this image never builds still fails the build
# with "failed to load manifest for workspace member".
COPY ./citadel-workspace-executor /usr/src/app/citadel-workspace-executor
COPY ./citadel-internal-service /usr/src/app/citadel-internal-service

# Build release binary during docker build (not at container startup).
#
# `deadlock-detection` was previously enabled here, but it spawns a background
# thread that sweeps every parking_lot mutex every 5 seconds -- pure runtime
# overhead in production where deadlocks should be diagnosed via stack traces,
# not by paying the constant bookkeeping cost. The feature stays available for
# local debugging and is OFF for the image that actually ships.
#
# `-p` is load-bearing, not tidiness. Without it the selected package set is the
# whole workspace, and `citadel-workspace-server-kernel/tests/common` is a
# member that pulls citadel_sdk with `features = ["localhost-testing"]`. Cargo
# unifies features across the selected set, so that landed in the SHIPPED
# binary. At the pinned SDK revision it is not a logging switch:
#
#   citadel_wire/udp_traversal/linear/encrypted_config_container.rs:72
#     "In localhost-testing mode, encryption is disabled (identity functions
#      used)" -- NAT-traversal config packets go out in plaintext
#   citadel_wire/udp_traversal/udp_hole_puncher.rs:275
#     "there are no reachable STUN servers; skip probing entirely"
#   plus loopback-only UDP binding and a NAT type of `offline()`
#
# So P2P worked in the dev compose stack and could not traverse a real NAT in
# production, silently. The sibling image already avoids this, via
# docker/workspace-server/Cargo.docker.toml, whose header says
# "Excludes tests/common to avoid localhost-testing feature unification".
# This Dockerfile never got the mitigation.
#
# Verified with `cargo tree -e features -i citadel_sdk`: the feature is present
# workspace-wide and absent under `-p citadel-workspace-internal-service`.
RUN cargo build --release -p citadel-workspace-internal-service --bin citadel-workspace-internal-service

# Copy binary to /usr/local/bin so it is not shadowed by the target_cache volume
# mount the dev compose file attaches at /usr/src/app/target.
RUN cp ./target/release/citadel-workspace-internal-service /usr/local/bin/

# =============================================================================
# Production runtime: binary only. No toolchain, no source, no target/.
# Selected explicitly with `target: production`; never the default (see above).
# =============================================================================
FROM debian:trixie-slim AS production

# Runtime dependencies only, derived from `ldd` against the built binary:
#   libssl3t64 - provides BOTH libssl.so.3 and libcrypto.so.3. Named `libssl3t64`, not
#                `libssl3`: on Debian trixie the 64-bit time_t transition renamed the real
#                package, and `libssl3` survives only as a virtual Provides: alias. Installing
#                via the alias works today (verified), but naming the real package is explicit
#                and does not depend on an alias that a future point release may drop.
#   libzstd1 - libzstd.so.1
#   zlib1g   - libz.so.1
# (libc, libm and libgcc_s already ship in the slim base.)
#
# Verified NOT needed: GTK/GDK/glib. The `rfd` crate (native file dialogs) does
# not pull a desktop stack into this binary -- `ldd` shows zero GTK linkage --
# so there is no reason to bloat the runtime with one.
#
# `netcat-openbsd` is NOT optional: the compose healthchecks probe the listener
# with `nc -z`. Without it the container sits permanently "unhealthy" and
# deploy.sh aborts waiting on a probe that can never pass.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        libssl3t64 \
        libzstd1 \
        zlib1g \
        netcat-openbsd && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# The port is baked in as an ENV because the CMD below expands it at runtime.
# ARGs do not cross stage boundaries, so it must be re-declared here.
ARG INTERNAL_SERVICE_PORT
ENV INTERNAL_SERVICE_PORT=${INTERNAL_SERVICE_PORT}

COPY --from=builder /usr/local/bin/citadel-workspace-internal-service /usr/local/bin/citadel-workspace-internal-service

# NOTE: kernel.toml is deliberately NOT copied here. It is an input to the
# workspace *server*; the internal service takes all of its configuration from
# CLI flags and env vars (see the CMD below and `select_backend_type` in
# citadel-workspace-internal-service/src/main.rs) and never reads a config file.

# Data directory for the filesystem backend (a volume is mounted here)
RUN mkdir -p /data/internal-service

# Run as non-root. Same uid (1000) as the dev stage so a data volume written by
# one stage stays writable by the other.
RUN useradd -m -u 1000 appuser && \
    chown appuser /usr/local/bin/citadel-workspace-internal-service && \
    chown -R appuser /data/internal-service
USER appuser

EXPOSE ${INTERNAL_SERVICE_PORT}

# Persistence is opt-in via env vars so dev (`tilt`) keeps the documented
# ephemeral behaviour from CLAUDE.md. Production sets both vars in the compose
# file; dev leaves them unset and the binary falls through to its in-memory
# default.
#
# The shell-only `${VAR:+ --flag "$VAR"}` form expands to nothing when the env
# var is unset, so dev gets a clean `--bind` invocation. The `$VAR` references
# are double-quoted so a path containing whitespace survives word-splitting and
# reaches structopt as a single argument.
#
# The bind host is `INTERNAL_SERVICE_BIND_HOST`, defaulting to `127.0.0.1`.
#
# LOOPBACK, not `0.0.0.0`. This process holds decrypted P2P plaintext and an
# UNAUTHENTICATED control plane: anything that can open a socket to it can claim
# an orphaned session, read another account's persisted store, and deregister the
# account. It is loopback-only by design.
#
# This defaulted to `0.0.0.0`. Every compose file in the repository sets the
# variable explicitly, so the default only ever applied when somebody ran the
# image directly -- `docker run`, a new compose file, a typo in the variable name
# -- which is exactly the case with nobody reviewing it. The default has to be
# safe when the operator changes nothing.
#
# scripts/check-agent-binds-loopback.mjs read only docker-compose*.yml, so it
# reported this image as loopback-only for as long as the default was wrong.
# `--no-tls` is stated, not inherited.
#
# The agent serves TLS by DEFAULT, because the binary a user downloads is dialled
# straight from an https page (`wss://local.avarok.net:12345`) and a secure
# context cannot open a `ws://` socket. That default is right for that topology
# and wrong for this one: in the container the agent is never dialled by a
# browser. nginx fronts it -- `proxy_pass http://${AGENT_UPSTREAM}/` in
# docker/ui/nginx.conf.template -- and so does the Vite dev proxy, `target:
# ws://127.0.0.1:${AGENT_PORT}` in citadel-workspaces/vite.config.ts. Both speak
# plaintext to it over loopback.
#
# When TLS became the default, neither proxy was changed, so both dialled a
# plaintext socket at a TLS listener and every handshake died as a bare 1006
# `Connection closed before receiving a handshake response` -- with the agent
# running, the port open, and nothing in either log saying why. Measured against
# a current agent: the dev server could not reach it at all.
#
# Adding TLS to the proxy hop would buy nothing; it is loopback, inside the same
# trust boundary the `--bind` note above describes. What was missing is that this
# launch site never said which mode it wanted, so it silently followed a default
# chosen for a different deployment. Both sides are now explicit, and
# scripts/check-agent-tls-matches-its-proxies.mjs holds them to each other.
CMD ["sh", "-c", "/usr/local/bin/citadel-workspace-internal-service --no-tls --bind ${INTERNAL_SERVICE_BIND_HOST:-127.0.0.1}:${INTERNAL_SERVICE_PORT}${INTERNAL_SERVICE_BACKEND:+ --backend \"$INTERNAL_SERVICE_BACKEND\"}${INTERNAL_SERVICE_DATA_DIR:+ --data-dir \"$INTERNAL_SERVICE_DATA_DIR\"}"]

# =============================================================================
# Dev runtime: equivalent to the previous single-stage image. Retains the
# toolchain, source and target/ for the tilt rebuild loop.
#
# MUST REMAIN THE LAST STAGE -- it is the default target for docker-compose.yml,
# which pins no target for this service.
# =============================================================================
FROM builder AS dev

ARG INTERNAL_SERVICE_PORT
ENV INTERNAL_SERVICE_PORT=${INTERNAL_SERVICE_PORT}

# Dynamically expose the port from the build argument
EXPOSE ${INTERNAL_SERVICE_PORT}

# Create data directory for persistent storage
RUN mkdir -p /data/internal-service

# Run as non-root user for security hardening
RUN useradd -m -u 1000 appuser
RUN chown appuser /usr/local/bin/citadel-workspace-internal-service
RUN chown -R appuser /data/internal-service
USER appuser

# `--no-tls` is stated, not inherited.
#
# The agent serves TLS by DEFAULT, because the binary a user downloads is dialled
# straight from an https page (`wss://local.avarok.net:12345`) and a secure
# context cannot open a `ws://` socket. That default is right for that topology
# and wrong for this one: in the container the agent is never dialled by a
# browser. nginx fronts it -- `proxy_pass http://${AGENT_UPSTREAM}/` in
# docker/ui/nginx.conf.template -- and so does the Vite dev proxy, `target:
# ws://127.0.0.1:${AGENT_PORT}` in citadel-workspaces/vite.config.ts. Both speak
# plaintext to it over loopback.
#
# When TLS became the default, neither proxy was changed, so both dialled a
# plaintext socket at a TLS listener and every handshake died as a bare 1006
# `Connection closed before receiving a handshake response` -- with the agent
# running, the port open, and nothing in either log saying why. Measured against
# a current agent: the dev server could not reach it at all.
#
# Adding TLS to the proxy hop would buy nothing; it is loopback, inside the same
# trust boundary the `--bind` note above describes. What was missing is that this
# launch site never said which mode it wanted, so it silently followed a default
# chosen for a different deployment. Both sides are now explicit, and
# scripts/check-agent-tls-matches-its-proxies.mjs holds them to each other.
CMD ["sh", "-c", "/usr/local/bin/citadel-workspace-internal-service --no-tls --bind ${INTERNAL_SERVICE_BIND_HOST:-127.0.0.1}:${INTERNAL_SERVICE_PORT}${INTERNAL_SERVICE_BACKEND:+ --backend \"$INTERNAL_SERVICE_BACKEND\"}${INTERNAL_SERVICE_DATA_DIR:+ --data-dir \"$INTERNAL_SERVICE_DATA_DIR\"}"]
