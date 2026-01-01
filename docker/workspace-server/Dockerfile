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
COPY ./Cargo.toml /usr/src/app/Cargo.toml
COPY ./Cargo.lock /usr/src/app/Cargo.lock
COPY ./citadel-workspace-server-kernel /usr/src/app/citadel-workspace-server-kernel
COPY ./citadel-workspace-internal-service /usr/src/app/citadel-workspace-internal-service
COPY ./citadel-workspace-types /usr/src/app/citadel-workspace-types
COPY ./citadel-internal-service /usr/src/app/citadel-internal-service
# Expose port if server listens on one (replace 12349 with actual port if needed)
EXPOSE 12349

# Set environment variables for build - skips WASM build in Docker
ENV SKIP_WASM_BUILD=1
ENV DOCKER_CONTAINER=1

# Run for sanity
RUN cargo clippy --tests

# Run the workspace server via cargo run
CMD ["cargo", "run", "--bin", "citadel-workspace-server-kernel", "--", "--config", "/usr/src/app/kernel.toml"]
