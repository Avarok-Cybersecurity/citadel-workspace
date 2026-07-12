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
COPY ./citadel-workspace-server-kernel /usr/src/app/citadel-workspace-server-kernel
COPY ./citadel-workspace-internal-service /usr/src/app/citadel-workspace-internal-service
COPY ./citadel-workspace-types /usr/src/app/citadel-workspace-types
COPY ./citadel-internal-service /usr/src/app/citadel-internal-service

# Build release binary during docker build (not at container startup).
#
# `deadlock-detection` was previously enabled here, but it spawns a background
# thread that sweeps every parking_lot mutex every 5 seconds -- pure runtime
# overhead in production where deadlocks should be diagnosed via stack traces,
# not by paying the constant bookkeeping cost. The feature stays available for
# local debugging and is OFF for the image that actually ships.
RUN cargo build --release --bin citadel-workspace-internal-service

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
# The bind host is `INTERNAL_SERVICE_BIND_HOST` (default `0.0.0.0`).
CMD ["sh", "-c", "/usr/local/bin/citadel-workspace-internal-service --bind ${INTERNAL_SERVICE_BIND_HOST:-0.0.0.0}:${INTERNAL_SERVICE_PORT}${INTERNAL_SERVICE_BACKEND:+ --backend \"$INTERNAL_SERVICE_BACKEND\"}${INTERNAL_SERVICE_DATA_DIR:+ --data-dir \"$INTERNAL_SERVICE_DATA_DIR\"}"]

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

CMD ["sh", "-c", "/usr/local/bin/citadel-workspace-internal-service --bind ${INTERNAL_SERVICE_BIND_HOST:-0.0.0.0}:${INTERNAL_SERVICE_PORT}${INTERNAL_SERVICE_BACKEND:+ --backend \"$INTERNAL_SERVICE_BACKEND\"}${INTERNAL_SERVICE_DATA_DIR:+ --data-dir \"$INTERNAL_SERVICE_DATA_DIR\"}"]
