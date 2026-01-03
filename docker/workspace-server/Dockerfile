# syntax=docker.io/docker/dockerfile:1.7-labs
# Base image with Rust
FROM rust:latest

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
COPY ./Cargo.lock /usr/src/app/Cargo.lock
# Copy kernel without tests directory (tests/common has localhost-testing feature)
COPY --exclude=tests ./citadel-workspace-server-kernel /usr/src/app/citadel-workspace-server-kernel
# Replace kernel's Cargo.toml with Docker-specific version (no dev-dependencies)
COPY ./docker/workspace-server/citadel-workspace-server-kernel.Cargo.docker.toml /usr/src/app/citadel-workspace-server-kernel/Cargo.toml
COPY ./citadel-workspace-internal-service /usr/src/app/citadel-workspace-internal-service
COPY ./citadel-workspace-types /usr/src/app/citadel-workspace-types
COPY ./citadel-internal-service /usr/src/app/citadel-internal-service
# Expose port if server listens on one (replace 12349 with actual port if needed)
EXPOSE 12349

# Set environment variables for build - skips WASM build in Docker
ENV SKIP_WASM_BUILD=1
ENV DOCKER_CONTAINER=1

# Run clippy WITHOUT --tests to avoid enabling dev-dependencies (localhost-testing feature)
RUN cargo clippy --bin citadel-workspace-server-kernel

# Build release binary to avoid dev-dependency features leaking through
RUN cargo build --release --bin citadel-workspace-server-kernel

# Copy binary to /usr/local/bin to avoid being shadowed by target_cache volume mount
# The docker-compose.yml mounts a volume at /usr/src/app/target for cargo caching,
# which would hide the binary built in the image. This copy ensures the binary is available.
RUN cp ./target/release/citadel-workspace-server-kernel /usr/local/bin/

# Run the workspace server from /usr/local/bin (not shadowed by volume mounts)
CMD ["/usr/local/bin/citadel-workspace-server-kernel", "--config", "/usr/src/app/kernel.toml"]
