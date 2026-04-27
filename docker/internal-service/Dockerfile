# syntax=docker.io/docker/dockerfile:1.7-labs
# Base image with Rust
FROM rust:1.92.0

WORKDIR /usr/src/app
ARG INTERNAL_SERVICE_PORT
ENV INTERNAL_SERVICE_PORT=${INTERNAL_SERVICE_PORT}
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

# Dynamically expose the port from the build argument
EXPOSE ${INTERNAL_SERVICE_PORT}

# Build release binary during docker build (not at container startup).
#
# `deadlock-detection` was previously enabled here, but it spawns a
# background thread that sweeps every parking_lot mutex every 5
# seconds — pure runtime overhead in production where deadlocks should
# be diagnosed via stack traces, not by paying the constant
# bookkeeping cost. The feature stays available for local debugging
# (enable explicitly when reproducing a hang) and is OFF for the
# image that actually ships.
RUN cargo build --release --bin citadel-workspace-internal-service

# Copy binary to /usr/local/bin to avoid being shadowed by target_cache volume mount
RUN cp ./target/release/citadel-workspace-internal-service /usr/local/bin/

# Create data directory for persistent storage
RUN mkdir -p /data/internal-service

# Run as non-root user for security hardening
RUN useradd -m -u 1000 appuser
RUN chown appuser /usr/local/bin/citadel-workspace-internal-service
RUN chown -R appuser /data/internal-service
USER appuser

# Run the pre-built internal service binary.
#
# Persistence is opt-in via env vars so dev (`tilt`) keeps the
# documented ephemeral behaviour from CLAUDE.md ("any accounts created
# on one will be lost on reload"). Production sets both vars in
# docker-compose.production.yml; dev leaves them unset and the binary
# falls through to its in-memory default.
#
# The shell-only `${VAR:+ --flag $VAR}` form expands to nothing when
# the env var is unset, so dev gets a clean `--bind` invocation.
CMD ["sh", "-c", "/usr/local/bin/citadel-workspace-internal-service --bind 0.0.0.0:${INTERNAL_SERVICE_PORT}${INTERNAL_SERVICE_BACKEND:+ --backend $INTERNAL_SERVICE_BACKEND}${INTERNAL_SERVICE_DATA_DIR:+ --data-dir $INTERNAL_SERVICE_DATA_DIR}"]
