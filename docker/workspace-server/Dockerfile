# syntax=docker.io/docker/dockerfile:1.7-labs
# =============================================================================
# Workspace Server image.
#
# Stages:
#   builder     - full Rust toolchain; compiles the release binary
#   production  - slim runtime: the ~29 MB binary + its shared libs, nothing else
#   dev         - LAST stage, and therefore the DEFAULT build target
#
# STAGE ORDER IS LOAD-BEARING. `docker build` with no `--target` builds the
# LAST stage, and `docker-compose.yml` (dev / tilt / CI integration tests) does
# NOT pin a target for this service -- unlike `ui`, which pins `target: dev`.
# If `production` were last, every dev and CI build would silently receive a
# toolchain-less image and the `target_cache`-backed rebuild loop would break.
# So `dev` is kept last and is equivalent to the previous single-stage image;
# production opts in explicitly via `target: production`.
#
# Why a slim runtime stage exists at all: the single-stage image was 5.65 GB,
# because it shipped the Rust toolchain, the full source tree and `target/` to
# production. The binary is 29 MB, and `ldd` reports it needs only libssl3 /
# libcrypto3, libzstd1 and libz on top of what the base already carries (libc,
# libgcc, libm). Publishing 5.65 GB to a registry -- and making every developer
# pull it -- is untenable; the slim stage lands at roughly 150 MB instead.
# =============================================================================

FROM rust:1.92.0 AS builder

WORKDIR /usr/src/app

# Install necessary build dependencies for crates like oqs-sys (which uses bindgen)
RUN apt-get update && \
    apt-get install -y cmake libclang-dev llvm clang net-tools netcat-openbsd curl && \
    rm -rf /var/lib/apt/lists/*

RUN rustup component add clippy

COPY ./docker/workspace-server/kernel.toml /usr/src/app/kernel.toml
COPY ./docker/workspace-server/documents /usr/src/app/documents
# Use Docker workspace Cargo.toml which excludes tests/common from members
COPY ./docker/workspace-server/Cargo.docker.toml /usr/src/app/Cargo.toml
# Copy kernel without tests directory (tests/common has localhost-testing feature)
COPY --exclude=tests ./citadel-workspace-server-kernel /usr/src/app/citadel-workspace-server-kernel
# Replace kernel's Cargo.toml with Docker-specific version (no dev-dependencies)
COPY ./docker/workspace-server/citadel-workspace-server-kernel.Cargo.docker.toml /usr/src/app/citadel-workspace-server-kernel/Cargo.toml
COPY ./citadel-workspace-internal-service /usr/src/app/citadel-workspace-internal-service
COPY ./citadel-workspace-types /usr/src/app/citadel-workspace-types
COPY ./citadel-internal-service /usr/src/app/citadel-internal-service

# Set environment variables for build - skips WASM build in Docker
ENV SKIP_WASM_BUILD=1
ENV DOCKER_CONTAINER=1

# Run clippy WITHOUT --tests to avoid enabling dev-dependencies (localhost-testing feature)
RUN cargo clippy --bin citadel-workspace-server-kernel

# Build release binary to avoid dev-dependency features leaking through
RUN cargo build --release --bin citadel-workspace-server-kernel

# Copy binary to /usr/local/bin so it is not shadowed by the target_cache volume
# mount the dev compose file attaches at /usr/src/app/target.
RUN cp ./target/release/citadel-workspace-server-kernel /usr/local/bin/

# =============================================================================
# Production runtime: binary + assets only. No toolchain, no source, no target/.
# Selected explicitly with `target: production`; never the default (see above).
# =============================================================================
FROM debian:trixie-slim AS production

# Runtime dependencies only, derived from `ldd` against the built binary:
#   libssl3  - provides BOTH libssl.so.3 and libcrypto.so.3
#   libzstd1 - libzstd.so.1
#   zlib1g   - libz.so.1
# (libc, libm and libgcc_s already ship in the slim base.)
#
# `netcat-openbsd` is NOT optional: the compose healthchecks probe the listener
# with `nc -z 127.0.0.1 12349`. Without it the container would sit permanently
# "unhealthy" and deploy.sh would abort every deploy waiting on a probe that
# can never pass.
#
# `ca-certificates` is required for outbound TLS verification.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        libssl3 \
        libzstd1 \
        zlib1g \
        netcat-openbsd && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY --from=builder /usr/local/bin/citadel-workspace-server-kernel /usr/local/bin/citadel-workspace-server-kernel

# kernel.toml and documents/ are RUNTIME assets, not build inputs: `content_base_dir`
# in kernel.toml points at documents/defaults/root, which the server reads on first
# boot to seed the initial workspace structure. Omitting them would leave the server
# unable to start.
COPY ./docker/workspace-server/kernel.toml /usr/src/app/kernel.toml
COPY ./docker/workspace-server/documents /usr/src/app/documents

# Data directory for the filesystem backend (a volume is mounted here in production)
RUN mkdir -p /data/server

# Run as non-root. Same uid (1000) as the dev stage so a data volume written by
# one stage stays writable by the other.
RUN useradd -m -u 1000 appuser && \
    chown appuser /usr/local/bin/citadel-workspace-server-kernel && \
    chown appuser /usr/src/app/kernel.toml && \
    chown -R appuser /usr/src/app/documents && \
    chown -R appuser /data/server
USER appuser

EXPOSE 12349

CMD ["/usr/local/bin/citadel-workspace-server-kernel", "--config", "/usr/src/app/kernel.toml"]

# =============================================================================
# Dev runtime: equivalent to the previous single-stage image. Retains the
# toolchain, source and target/ for the tilt rebuild loop.
#
# MUST REMAIN THE LAST STAGE -- it is the default target for docker-compose.yml,
# which pins no target for this service.
# =============================================================================
FROM builder AS dev

EXPOSE 12349

# Create data directory for persistent storage
RUN mkdir -p /data/server

# Run as non-root user for security hardening
RUN useradd -m -u 1000 appuser
RUN chown appuser /usr/local/bin/citadel-workspace-server-kernel && \
    chown appuser /usr/src/app/kernel.toml && \
    chown -R appuser /usr/src/app/documents && \
    chown -R appuser /data/server
USER appuser

# Run the workspace server from /usr/local/bin (not shadowed by volume mounts)
CMD ["/usr/local/bin/citadel-workspace-server-kernel", "--config", "/usr/src/app/kernel.toml"]
