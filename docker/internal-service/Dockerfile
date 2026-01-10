# syntax=docker.io/docker/dockerfile:1.7-labs
# Base image with Rust
FROM rust:latest

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
COPY ./Cargo.lock /usr/src/app/Cargo.lock
COPY ./citadel-workspace-server-kernel /usr/src/app/citadel-workspace-server-kernel
COPY ./citadel-workspace-internal-service /usr/src/app/citadel-workspace-internal-service
COPY ./citadel-workspace-types /usr/src/app/citadel-workspace-types
COPY ./citadel-internal-service /usr/src/app/citadel-internal-service

# Dynamically expose the port from the build argument
EXPOSE ${INTERNAL_SERVICE_PORT}

# Build release binary during docker build (not at container startup)
RUN cargo build --release --bin citadel-workspace-internal-service --features deadlock-detection

# Copy binary to /usr/local/bin to avoid being shadowed by target_cache volume mount
RUN cp ./target/release/citadel-workspace-internal-service /usr/local/bin/

# Run the pre-built internal service binary
CMD ["sh", "-c", "/usr/local/bin/citadel-workspace-internal-service --bind 0.0.0.0:${INTERNAL_SERVICE_PORT}"]
